// ============================================================
// Stellar Conquest — High-Performance Rewrite
// Same gameplay, zero per-frame allocations, spatial hashing,
// instanced WebGL rendering, pooled ship arrays.
// ============================================================

const DEBUG = true;

const canvas = document.getElementById('gameCanvas');
const overlayCanvas = document.getElementById('overlayCanvas');
const ctx = overlayCanvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
overlayCanvas.width = window.innerWidth;
overlayCanvas.height = window.innerHeight;
window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    overlayCanvas.width = window.innerWidth;
    overlayCanvas.height = window.innerHeight;
});

// ===== CONSTANTS =====
const TEAM_COLORS = ['#888888', '#4ade80', '#f87171', '#60a5fa', '#fbbf24', '#c084fc'];
const TEAM_NAMES = ['Neutral', 'Green Alliance', 'Red Empire', 'Blue Federation', 'Gold Collective', 'Purple Dynasty'];
// Team indices: 0=neutral, 1-5=teams

const BASE_W = 1920;
const BASE_H = 1080;

const BASE_CAP = 20;
const CAP_AMNT = 15;
const BASE_REGEN = 0.5;
const BASE_PLANET_REGEN = 2;
const ATTACK_COOLDOWN = 1.0;
const ATTACK_RANGE = 50;
const ATTACK_RANGE_SQ = ATTACK_RANGE * ATTACK_RANGE;
const SHIP_SPEED = 80;
const PRODUCTION_INTERVAL = 2.0;
const SHIP_RADIUS = 5;
const SHIP_SPACING = 10;
const SHIP_SPACING_SQ = SHIP_SPACING * SHIP_SPACING;
const PLANET_CLEARANCE = 15;
const STARTING_SHIPS = 10;
const MAX_CONNECTION_DISTANCE = 300;

const BASE_ATTACK = 10;
const BASE_DEFENSE = 10;
const BASE_SPEED = 80;
const ATTACK_PER_TOKEN = 5;
const DEFENSE_PER_TOKEN = 5;
const SPEED_PER_TOKEN = 10;
const SHIP_CAP_PER_DEFENSE_TOKEN = 10;
const PRODUCTION_SPEED_PER_DEFENSE_TOKEN = 0.1;
const HEALTH_PER_DEFENSE_TOKEN = 25;

// reduce to make AI earn tokens slower (e.g. 0.5 = half speed)
const AI_POINTS_MULTIPLIER = 0.5;

// ===== SPATIAL HASH GRID =====
class SpatialGrid {
    constructor(cellSize) {
        this.cellSize = cellSize;
        this.invCellSize = 1 / cellSize;
        this.cells = new Map();
        this._keyBuf = 0; // reusable
    }

    clear() {
        this.cells.clear();
    }

    _key(cx, cy) {
        // Cantor-like pairing
        return (cx * 73856093) ^ (cy * 19349663);
    }

    insert(id, x, y) {
        const cx = (x * this.invCellSize) | 0;
        const cy = (y * this.invCellSize) | 0;
        const k = this._key(cx, cy);
        let cell = this.cells.get(k);
        if (!cell) {
            cell = [];
            this.cells.set(k, cell);
        }
        cell.push(id);
    }

    // Query all IDs in range (square region), calls callback(id) for each
    query(x, y, radius, callback) {
        const inv = this.invCellSize;
        const minCX = ((x - radius) * inv) | 0;
        const maxCX = ((x + radius) * inv) | 0;
        const minCY = ((y - radius) * inv) | 0;
        const maxCY = ((y + radius) * inv) | 0;

        for (let cx = minCX; cx <= maxCX; cx++) {
            for (let cy = minCY; cy <= maxCY; cy++) {
                const cell = this.cells.get(this._key(cx, cy));
                if (cell) {
                    for (let i = 0, len = cell.length; i < len; i++) {
                        callback(cell[i]);
                    }
                }
            }
        }
    }
}

// ===== PLANET =====
class Planet {
    constructor(id, x, y, team, baseHealth, productionRate, capacityContribution) {
        this.id = id;
        this.team = team;
        this.x = x;
        this.y = y;
        this.baseHealth = baseHealth;
        this.health = baseHealth;
        this.productionRate = productionRate;
        this.capacityContribution = capacityContribution;
        this.regenRate = BASE_PLANET_REGEN;
        this.productionTimer = 0;
        this.size = 20 + (baseHealth / 50);
        this.connections = []; // {targetId, bidirectional}
    }

    getMaxHealth(defenseTokens) {
        if (this.team === 0) return this.baseHealth;
        return this.baseHealth + (defenseTokens * HEALTH_PER_DEFENSE_TOKEN);
    }
}

// ===== SHIP POOL (Struct of Arrays) =====
// All ship data in flat typed arrays for cache-friendly iteration
const MAX_SHIPS = 2048;

const shipX = new Float32Array(MAX_SHIPS);
const shipY = new Float32Array(MAX_SHIPS);
const shipVX = new Float32Array(MAX_SHIPS);
const shipVY = new Float32Array(MAX_SHIPS);
const shipRot = new Float32Array(MAX_SHIPS);
const shipHealth = new Float32Array(MAX_SHIPS);
const shipMaxHealth = new Float32Array(MAX_SHIPS);
const shipTeam = new Uint8Array(MAX_SHIPS);
const shipNextAttack = new Float32Array(MAX_SHIPS);
const shipAtkAnimTime = new Float32Array(MAX_SHIPS);
const shipAtkTargetX = new Float32Array(MAX_SHIPS);
const shipAtkTargetY = new Float32Array(MAX_SHIPS);
// Target: -1 = none, >= 0 = planet index, -2 = position target
const shipTargetType = new Int16Array(MAX_SHIPS); // 0=none, 1=planet, 2=position, 3=ship(enemy)
const shipTargetIdx = new Int16Array(MAX_SHIPS);
const shipTargetPosX = new Float32Array(MAX_SHIPS);
const shipTargetPosY = new Float32Array(MAX_SHIPS);
const shipIsDefending = new Uint8Array(MAX_SHIPS);
const shipHomePlanet = new Int16Array(MAX_SHIPS); // -1 = none
// Combat assignment: index of enemy ship this frame, -1 = none
const shipCombatTarget = new Int32Array(MAX_SHIPS);

let shipCount = 0;
let nextShipId = 0;

// Free list for recycling dead ship slots
const freeSlots = [];

function allocShip() {
    let idx;
    if (freeSlots.length > 0) {
        idx = freeSlots.pop();
    } else {
        if (shipCount >= MAX_SHIPS) return -1;
        idx = shipCount++;
    }
    return idx;
}

function killShip(idx) {
    shipHealth[idx] = 0;
    freeSlots.push(idx);
}

function isShipAlive(idx) {
    return shipHealth[idx] > 0;
}

function spawnShip(team, x, y, homePlanetIdx) {
    const idx = allocShip();
    if (idx < 0) return -1;
    shipX[idx] = x;
    shipY[idx] = y;
    shipVX[idx] = 0;
    shipVY[idx] = 0;
    shipRot[idx] = Math.random() * Math.PI * 2;
    shipHealth[idx] = 100;
    shipMaxHealth[idx] = 100;
    shipTeam[idx] = team;
    shipNextAttack[idx] = 0;
    shipAtkAnimTime[idx] = 0;
    shipAtkTargetX[idx] = 0;
    shipAtkTargetY[idx] = 0;
    shipTargetType[idx] = 0;
    shipTargetIdx[idx] = -1;
    shipTargetPosX[idx] = x;
    shipTargetPosY[idx] = y;
    shipIsDefending[idx] = 1;
    shipHomePlanet[idx] = homePlanetIdx;
    shipCombatTarget[idx] = -1;
    return idx;
}

// ===== TEAM DATA =====
const teamAttackTokens = new Uint8Array(6);
const teamDefenseTokens = new Uint8Array(6);
const teamSpeedTokens = new Uint8Array(6);
const teamPoints = new Float64Array(6);
const teamTokens = new Uint16Array(6);
const teamTokensEarned = new Uint16Array(6);

// Pre-computed per frame
const teamAttack = new Float32Array(6);
const teamDefense = new Float32Array(6);
const teamSpeed = new Float32Array(6);
const teamDefenseLevel = new Float32Array(6);

function recomputeTeamStats() {
    for (let i = 0; i < 6; i++) {
        teamAttack[i] = BASE_ATTACK + teamAttackTokens[i] * ATTACK_PER_TOKEN;
        teamDefense[i] = BASE_DEFENSE + teamDefenseTokens[i] * DEFENSE_PER_TOKEN;
        teamSpeed[i] = BASE_SPEED + teamSpeedTokens[i] * SPEED_PER_TOKEN;
        teamDefenseLevel[i] = teamDefense[i] / 10;
    }
    teamDefenseLevel[0] = 1; // neutral
}

// Per-frame caches (avoid repeated counting)
const teamShipCount = new Uint16Array(6);
const teamPlanetCount = new Uint8Array(6);

function recomputeTeamCounts(planets) {
    teamShipCount.fill(0);
    teamPlanetCount.fill(0);
    for (let i = 0; i < shipCount; i++) {
        if (shipHealth[i] > 0) teamShipCount[shipTeam[i]]++;
    }
    for (let i = 0; i < planets.length; i++) {
        teamPlanetCount[planets[i].team]++;
    }
}

// ===== AI CONTROLLER =====
class AIController {
    constructor(teamIdx, game) {
        this.team = teamIdx;
        this.game = game;
        this.commandCooldown = 1.2;
        this.minShipsToAttack = 3;
        this.defenseRadius = 200;
        this.defenseThreshold = 3;
        this.defensePersistence = 4;
        this.defenseReserveRatio = 0.25;
        this.consecutiveDefense = 0;
        this.hasLoggedDefenseBreak = false;
        this.lastCommandTime = 0;
        this.currentTargetId = -1;
        // Scratch arrays to avoid allocation
        this._defenderIds = new Int32Array(MAX_SHIPS);
        this._offensiveIds = new Int32Array(MAX_SHIPS);
        this._scored = []; // reused
    }

    update(dt) {
        const g = this.game;
        if (g.gameOver) return;

        const team = this.team;
        const currentTime = g.gameTime;
        const myPlanetCount = teamPlanetCount[team];
        const myShipCount = teamShipCount[team];

        if (myPlanetCount === 0 && myShipCount === 0) return;

        // Homeless mode
        if (myPlanetCount === 0) {
            if (myShipCount === 0) return;

            // Check if current target still valid
            if (this.currentTargetId >= 0 && this.currentTargetId < g.planets.length) {
                const tp = g.planets[this.currentTargetId];
                if (tp.team !== team) {
                    this._sendAllShips(tp);
                    return;
                }
            }

            if (currentTime - this.lastCommandTime < this.commandCooldown) return;

            // Find nearest planet
            const centroid = this._getFleetCentroid();
            let bestDist = Infinity, bestPlanet = null;
            for (let i = 0; i < g.planets.length; i++) {
                const p = g.planets[i];
                if (p.team === team) continue;
                const dx = p.x - centroid.x, dy = p.y - centroid.y;
                const d = dx * dx + dy * dy;
                // Prefer neutral
                const bonus = p.team === 0 ? 0.5 : 1.0;
                if (d * bonus < bestDist) {
                    bestDist = d * bonus;
                    bestPlanet = p;
                }
            }
            if (bestPlanet) {
                this.currentTargetId = bestPlanet.id;
                this._sendAllShips(bestPlanet);
                this.lastCommandTime = currentTime;
            }
            return;
        }

        // Normal mode
        if (currentTime - this.lastCommandTime < this.commandCooldown) return;
        if (myShipCount < this.minShipsToAttack) return;

        // Identify threats
        const threats = this._getThreatenedPlanets();

        // Split fleet: defenders vs attackers
        const defenderBudget = Math.floor(myShipCount * this.defenseReserveRatio);
        const defenderSet = new Set();
        let remainingBudget = defenderBudget;

        if (threats.length > 0 && this.consecutiveDefense < this.defensePersistence) {
            for (let t = 0; t < threats.length && remainingBudget > 0; t++) {
                const needed = Math.min(Math.ceil(threats[t].count * 1.3), remainingBudget);
                const assigned = this._assignDefenders(threats[t].planet, needed, defenderSet);
                remainingBudget -= assigned;
            }
            this.consecutiveDefense++;
        } else if (threats.length === 0) {
            this.consecutiveDefense = 0;
        }

        if (this.consecutiveDefense >= this.defensePersistence && !this.hasLoggedDefenseBreak) {
            this.hasLoggedDefenseBreak = true;
            this.consecutiveDefense = 0;
        }

        // Count offensive ships
        let offCount = 0;
        for (let i = 0; i < shipCount; i++) {
            if (shipHealth[i] > 0 && shipTeam[i] === this.team && !defenderSet.has(i)) {
                this._offensiveIds[offCount++] = i;
            }
        }

        if (offCount < this.minShipsToAttack) {
            this.lastCommandTime = currentTime;
            return;
        }

        // Check if we should pick a new target
        const shouldPickNew = Math.random() < 0.15;
        let currentTargetPlanet = this.currentTargetId >= 0 ? this.game.planets[this.currentTargetId] : null;
        const needNewTarget = !currentTargetPlanet || currentTargetPlanet.team === this.team || shouldPickNew;

        if (!needNewTarget) {
            this._assignAttackers(this._offensiveIds, offCount, currentTargetPlanet);
            this.lastCommandTime = currentTime;
            return;
        }

        // Score reachable targets
        const reachable = this.game.getReachablePlanets(this.team);
        this._scored.length = 0;
        const centroid = this._getTeamPlanetCentroid();

        for (let i = 0; i < reachable.length; i++) {
            const p = reachable[i];
            if (p.team === this.team) continue;
            const dx = p.x - centroid.x, dy = p.y - centroid.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const maxHP = p.getMaxHealth(teamDefenseTokens[p.team]);
            const hpFrac = p.health / maxHP;

            let score = p.team === 0 ? 40 : 20;
            score -= dist * 0.05;
            score -= hpFrac * 15;
            score += (1 - hpFrac) * 20;
            if (offCount > 30 && p.team !== 0) score += 15;
            this._scored.push({ planet: p, score });
        }

        if (this._scored.length === 0) {
            this.lastCommandTime = currentTime;
            return;
        }

        this._scored.sort((a, b) => b.score - a.score);

        // Possibly split attack
        if (offCount >= 20 && this._scored.length >= 2 &&
            this._scored[0].score - this._scored[1].score < 15) {
            const half = offCount >> 1;
            this._assignAttackersSlice(this._offensiveIds, 0, half, this._scored[0].planet);
            this._assignAttackersSlice(this._offensiveIds, half, offCount, this._scored[1].planet);
            this.currentTargetId = this._scored[0].planet.id;
        } else {
            const best = this._scored[0].planet;
            this._assignAttackers(this._offensiveIds, offCount, best);
            this.currentTargetId = best.id;
        }

        this.consecutiveDefense = 0;
        this.hasLoggedDefenseBreak = false;
        this.lastCommandTime = currentTime;
    }

    _sendAllShips(planet) {
        for (let i = 0; i < shipCount; i++) {
            if (shipHealth[i] > 0 && shipTeam[i] === this.team) {
                shipTargetType[i] = 1;
                shipTargetIdx[i] = planet.id;
                shipTargetPosX[i] = planet.x;
                shipTargetPosY[i] = planet.y;
                shipIsDefending[i] = 0;
            }
        }
    }

    _getFleetCentroid() {
        let cx = 0, cy = 0, n = 0;
        for (let i = 0; i < shipCount; i++) {
            if (shipHealth[i] > 0 && shipTeam[i] === this.team) {
                cx += shipX[i]; cy += shipY[i]; n++;
            }
        }
        return n > 0 ? { x: cx / n, y: cy / n } : { x: 0, y: 0 };
    }

    _getTeamPlanetCentroid() {
        let cx = 0, cy = 0, n = 0;
        for (const p of this.game.planets) {
            if (p.team === this.team) { cx += p.x; cy += p.y; n++; }
        }
        return n > 0 ? { x: cx / n, y: cy / n } : { x: 0, y: 0 };
    }

    _getThreatenedPlanets() {
        const threats = [];
        const g = this.game;
        for (const p of g.planets) {
            if (p.team !== this.team) continue;
            const radius = p.size + ATTACK_RANGE + 50;
            const rSq = radius * radius;
            let enemyCount = 0;
            for (let i = 0; i < shipCount; i++) {
                if (shipHealth[i] <= 0 || shipTeam[i] === this.team || shipTeam[i] === 0) continue;
                const dx = shipX[i] - p.x, dy = shipY[i] - p.y;
                if (dx * dx + dy * dy < rSq) enemyCount++;
            }
            if (enemyCount >= this.defenseThreshold) {
                threats.push({ planet: p, count: enemyCount });
            }
        }
        threats.sort((a, b) => b.count - a.count);
        return threats;
    }

    _assignDefenders(planet, needed, defenderSet) {
        // Collect distances of our unassigned ships to this planet
        const dists = [];
        for (let i = 0; i < shipCount; i++) {
            if (shipHealth[i] > 0 && shipTeam[i] === this.team && !defenderSet.has(i)) {
                const dx = shipX[i] - planet.x, dy = shipY[i] - planet.y;
                dists.push({ idx: i, d: dx * dx + dy * dy });
            }
        }
        dists.sort((a, b) => a.d - b.d);
        const count = Math.min(needed, dists.length);
        for (let i = 0; i < count; i++) {
            const idx = dists[i].idx;
            defenderSet.add(idx);
            shipTargetType[idx] = 1;
            shipTargetIdx[idx] = planet.id;
            shipTargetPosX[idx] = planet.x;
            shipTargetPosY[idx] = planet.y;
            shipIsDefending[idx] = 1;
            shipHomePlanet[idx] = planet.id;
        }
        return count;
    }

    _assignAttackers(ids, count, planet) {
        for (let i = 0; i < count; i++) {
            const idx = ids[i];
            shipTargetType[idx] = 1;
            shipTargetIdx[idx] = planet.id;
            shipTargetPosX[idx] = planet.x;
            shipTargetPosY[idx] = planet.y;
            shipIsDefending[idx] = 0;
        }
    }

    _assignAttackersSlice(ids, from, to, planet) {
        for (let i = from; i < to; i++) {
            const idx = ids[i];
            shipTargetType[idx] = 1;
            shipTargetIdx[idx] = planet.id;
            shipTargetPosX[idx] = planet.x;
            shipTargetPosY[idx] = planet.y;
            shipIsDefending[idx] = 0;
        }
    }
}

// ===== GAME =====
class Game {
    constructor(settings = {}) {
        this.settings = {
            galaxySize: settings.galaxySize || 'medium',
            playerCount: settings.playerCount || 2,
            aiOnlyMode: settings.aiOnlyMode || false,
            idleMode: settings.idleMode || false,
            batchTestMode: settings.batchTestMode || false,
            speedMultiplier: settings.speedMultiplier || 1,
            aiPointsMultiplier: settings.aiPointsMultiplier || 0.5
        };

        this.planets = [];
        this.targetPlanets = []; // player selection
        this.paused = false;
        this.gameOver = false;
        this.stopped = false;
        this.winner = -1;
        this.frameCount = 0;
        this.gameTime = 0;
        this.accumulator = 0;

        this.BASE_TOKEN_COST = 50;
        this.TOKEN_COST_INCREASE = 25;
        this.POINTS_PER_PLANET = 50;
        this.POINTS_PER_SHIP = 5;

        // Reset global ship pool
        shipCount = 0;
        nextShipId = 0;
        freeSlots.length = 0;
        shipHealth.fill(0);

        // Reset team data
        teamAttackTokens.fill(0);
        teamDefenseTokens.fill(0);
        teamSpeedTokens.fill(0);
        teamPoints.fill(0);
        teamTokens.fill(0);
        teamTokensEarned.fill(0);

        // Neutral gets base 2 each
        teamAttackTokens[0] = 2; teamDefenseTokens[0] = 2; teamSpeedTokens[0] = 2;
        // Teams start with 6 tokens
        for (let i = 1; i <= 5; i++) teamTokens[i] = 6;

        this._applyInitialTokens();
        recomputeTeamStats();

        // Spatial grid
        this.grid = new SpatialGrid(ATTACK_RANGE);

        // Reachable planets cache (per team, rebuilt each frame)
        this._reachableCache = new Array(6);
        for (let i = 0; i < 6; i++) this._reachableCache[i] = [];
        this._reachableDirty = true;

        this.camera = { x: 0, y: 0, zoom: 1, isDragging: false, lastMouseX: 0, lastMouseY: 0, hasDragged: false };

        // AI controllers
        const activeTeams = [];
        for (let t = 2; t < 2 + this.settings.playerCount - 1 && t <= 5; t++) activeTeams.push(t);
        if (this.settings.aiOnlyMode) activeTeams.unshift(1);
        this.aiControllers = activeTeams.map(t => new AIController(t, this));

        this.gameStartTime = Date.now();

        this.initializePlanets();
        this.setupEventListeners();
        this.updateUpgradeUI();

        // Init WebGL renderer
        try {
            this.renderer = new WebGLRenderer(canvas);
            this.useWebGL = true;
            // Register all team colors
            this._colorIndices = [];
            for (let i = 0; i < TEAM_COLORS.length; i++) {
                this._colorIndices.push(this.renderer.registerColor(TEAM_COLORS[i]));
            }
            // Connection colors
            this._connBiColor = this.renderer.registerColor('#4a5568');
            this._connUniColor = this.renderer.registerColor('#2d3748');
            this._connBiRGBA = this._hexToRGBA('#4a5568');
            this._connUniRGBA = this._hexToRGBA('#2d3748');
        } catch (e) {
            console.warn('WebGL2 not available, falling back to Canvas2D:', e);
            this.useWebGL = false;
            this._colorIndices = [0, 1, 2, 3, 4, 5];
        }

        this.lastTime = Date.now();
        this.gameLoop();
    }

    _hexToRGBA(hex) {
        return [
            parseInt(hex.slice(1, 3), 16) / 255,
            parseInt(hex.slice(3, 5), 16) / 255,
            parseInt(hex.slice(5, 7), 16) / 255,
            1.0
        ];
    }

    _applyInitialTokens() {
        // team1: balanced 2/2/2
        this._spend(1, 'attack', 2); this._spend(1, 'defense', 2); this._spend(1, 'speed', 2);
        // team2: aggressive 4/1/1
        this._spend(2, 'attack', 4); this._spend(2, 'defense', 1); this._spend(2, 'speed', 1);
        // team3: tanky 1/4/1
        this._spend(3, 'attack', 1); this._spend(3, 'defense', 4); this._spend(3, 'speed', 1);
        // team4: balanced 2/2/2
        this._spend(4, 'attack', 2); this._spend(4, 'defense', 2); this._spend(4, 'speed', 2);
        // team5: fast 1/1/4
        this._spend(5, 'attack', 1); this._spend(5, 'defense', 1); this._spend(5, 'speed', 4);
    }

    _spend(team, stat, amount) {
        if (teamTokens[team] < amount) return false;
        teamTokens[team] -= amount;
        if (stat === 'attack') teamAttackTokens[team] += amount;
        else if (stat === 'defense') teamDefenseTokens[team] += amount;
        else if (stat === 'speed') teamSpeedTokens[team] += amount;
        return true;
    }

    getTokenCost(team) {
        return this.BASE_TOKEN_COST + teamTokensEarned[team] * this.TOKEN_COST_INCREASE;
    }

    awardPoints(team, points) {
        // Apply multiplier only to AI teams
        // In player mode: team 1 gets full points, teams 2-5 get reduced points
        // In AI-only mode: all teams (including team 1) get reduced points
        let adjusted;
        if (team === 1 && !this.settings.aiOnlyMode) {
            // Player team in player mode - full points
            adjusted = points;
        } else {
            // AI teams OR team 1 in AI-only mode - apply multiplier
            adjusted = points * this.settings.aiPointsMultiplier;
        }

        teamPoints[team] += adjusted;
        while (teamPoints[team] >= this.getTokenCost(team)) {
            teamPoints[team] -= this.getTokenCost(team);
            teamTokens[team]++;
            teamTokensEarned[team]++;
            if (team > 1 || this.settings.aiOnlyMode) this._aiSpendToken(team);
        }
    }

    _aiSpendToken(team) {
        const strategies = {
            1: ['attack', 'defense', 'speed', 'attack'],
            2: ['attack', 'attack', 'attack', 'speed'],
            3: ['defense', 'defense', 'defense', 'attack'],
            4: ['attack', 'defense', 'speed', 'attack'],
            5: ['speed', 'speed', 'speed', 'attack']
        };
        const strat = strategies[team] || ['attack', 'defense', 'speed', 'attack'];
        const totalSpent = teamAttackTokens[team] + teamDefenseTokens[team] + teamSpeedTokens[team];
        const stat = strat[totalSpent % strat.length];
        this._spend(team, stat, 1);
        recomputeTeamStats();
    }

    getMaxFleet(team) {
        if (team === 0) return teamPlanetCount[0] * STARTING_SHIPS;
        return BASE_CAP + teamPlanetCount[team] * CAP_AMNT + teamDefenseTokens[team] * SHIP_CAP_PER_DEFENSE_TOKEN;
    }

    // ===== PLANET INITIALIZATION =====
    initializePlanets() {
        const sizes = { small: 20, medium: 30, large: 40, huge: 50 };
        const mults = { small: 1.0, medium: 1.5, large: 2.0, huge: 2.5 };
        const zooms = { small: 1.0, medium: 0.7, large: 0.5, huge: 0.4 };

        const planetCounts = { small: 20, medium: 30, large: 40, huge: 50 };
        const total = planetCounts[this.settings.galaxySize] || 30;

        const worldRadii = { small: 600, medium: 900, large: 1400, huge: 2000 };
        const worldRadius = worldRadii[this.settings.galaxySize] || 900;
        const w = worldRadius * 2 + 300; // bounding square for camera
        const h = worldRadius * 2 + 300;
        const margin = 150;
        const minDist = 120;

        const positions = [];

        const tryPlace = () => {
            for (let a = 0; a < 200; a++) {
                const angle = Math.random() * Math.PI * 2;
                const r = worldRadius * Math.sqrt(Math.random()); // sqrt for uniform distribution
                const x = w / 2 + Math.cos(angle) * r;
                const y = h / 2 + Math.sin(angle) * r;
                let valid = true;
                for (let j = 0; j < positions.length; j++) {
                    const dx = x - positions[j].x, dy = y - positions[j].y;
                    if (dx * dx + dy * dy < minDist * minDist) { valid = false; break; }
                }
                if (valid) { positions.push({ x, y }); return { x, y }; }
            }
            return null;
        };

        const pos0 = { x: w / 2 + Math.cos(Math.PI) * (worldRadius * 0.8), y: h / 2 };
      const pos1 = { x: w / 2 + Math.cos(0) * (worldRadius * 0.8), y: h / 2 };
        positions.push(pos0, pos1);

        const numTeams = Math.min(this.settings.playerCount, 5);
        const zoom = zooms[this.settings.galaxySize] || 0.7;
        const fitZoomX = canvas.width / w;
        const fitZoomY = canvas.height / h;
        this.camera.zoom = Math.min(fitZoomX, fitZoomY);
        this.camera.x = canvas.width / 2 - (w / 2) * this.camera.zoom;
        this.camera.y = canvas.height / 2 - (h / 2) * this.camera.zoom;

        // Create team home planets
        for (let i = 0; i < numTeams; i++) {
            const pos = i === 0 ? pos0 : (i === 1 ? pos1 : tryPlace());
            if (pos) this.planets.push(new Planet(this.planets.length, pos.x, pos.y, i + 1, 200, 1, CAP_AMNT));
        }

        // Create neutral planets
        for (let i = numTeams; i < total; i++) {
            const pos = tryPlace();
            if (pos) {
                const hp = i < numTeams + 2 ? 150 : 100;
                this.planets.push(new Planet(this.planets.length, pos.x, pos.y, 0, hp, 1, CAP_AMNT));
            }
        }

        this.generateConnections();

        // Spawn starting ships
        for (let i = 0; i < numTeams; i++) {
            for (let j = 0; j < STARTING_SHIPS; j++) this.spawnShipAtPlanet(this.planets[i]);
        }
        for (const p of this.planets) {
            if (p.team === 0) {
                for (let j = 0; j < STARTING_SHIPS; j++) this.spawnShipAtPlanet(p);
            }
        }
    }

    spawnShipAtPlanet(planet) {
        const angle = Math.random() * Math.PI * 2;
        const dist = planet.size + 15;
        return spawnShip(planet.team, planet.x + Math.cos(angle) * dist, planet.y + Math.sin(angle) * dist, planet.id);
    }

    // ===== CONNECTION GENERATION =====
    generateConnections() {
        const maxAttempts = 10;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            for (const p of this.planets) p.connections = [];

            for (let i = 0; i < this.planets.length; i++) {
                const p = this.planets[i];
                const current = this._getUniqueConnCount(i);
                const needed = Math.max(0, (2 + (Math.random() * 3 | 0)) - current);
                if (needed <= 0) continue;

                let cands = this._getAvailableConns(i, MAX_CONNECTION_DISTANCE);
                if (cands.length < needed) cands = this._getAvailableConns(i, Infinity);

                for (let k = 0; k < Math.min(needed, cands.length); k++) {
                    const tid = cands[k].id;
                    const bi = Math.random() < 0.7;
                    p.connections.push({ targetId: tid, bidirectional: bi });
                    if (bi) this.planets[tid].connections.push({ targetId: i, bidirectional: true });
                }
            }

            this._ensureMinConns();
            this._fixIsolated();
            this._connectComponents();
            this._ensureBiConnectivity();

            if (this._validateBiReachability() && this._validateConns()) return;
        }
    }

    _getAvailableConns(pid, maxDist) {
        const p = this.planets[pid];
        const result = [];
        const maxDistSq = maxDist * maxDist;
        for (let j = 0; j < this.planets.length; j++) {
            if (j === pid) continue;
            const already = p.connections.some(c => c.targetId === j) ||
                this.planets[j].connections.some(c => c.targetId === pid);
            if (already) continue;
            const dx = p.x - this.planets[j].x, dy = p.y - this.planets[j].y;
            const dSq = dx * dx + dy * dy;
            if (dSq <= maxDistSq) result.push({ id: j, dist: dSq });
        }
        result.sort((a, b) => a.dist - b.dist);
        return result;
    }

    _getUniqueConnCount(pid) {
        const s = new Set();
        for (const c of this.planets[pid].connections) s.add(c.targetId);
        for (let i = 0; i < this.planets.length; i++) {
            if (i !== pid) {
                for (const c of this.planets[i].connections) {
                    if (c.targetId === pid) { s.add(i); break; }
                }
            }
        }
        return s.size;
    }

    _ensureMinConns() {
        for (let i = 0; i < this.planets.length; i++) {
            const unique = this._getUniqueConnCount(i);
            if (unique >= 2) continue;
            let cands = this._getAvailableConns(i, MAX_CONNECTION_DISTANCE);
            if (cands.length === 0) cands = this._getAvailableConns(i, Infinity);
            const needed = 2 - unique;
            for (let k = 0; k < Math.min(needed, cands.length); k++) {
                const tid = cands[k].id;
                this.planets[i].connections.push({ targetId: tid, bidirectional: true });
                this.planets[tid].connections.push({ targetId: i, bidirectional: true });
            }
        }
    }

    _fixIsolated() {
        for (let i = 0; i < this.planets.length; i++) {
            const p = this.planets[i];
            const hasOut = p.connections.length > 0;
            let hasIn = false;
            for (let j = 0; j < this.planets.length && !hasIn; j++) {
                if (j !== i) {
                    for (const c of this.planets[j].connections) {
                        if (c.targetId === i) { hasIn = true; break; }
                    }
                }
            }
            if (!hasOut || !hasIn) {
                for (const c of p.connections) {
                    if (!c.bidirectional) {
                        c.bidirectional = true;
                        const tp = this.planets[c.targetId];
                        if (!tp.connections.some(rc => rc.targetId === i)) {
                            tp.connections.push({ targetId: i, bidirectional: true });
                        }
                    }
                }
            }
        }
    }

    _getReachableFrom(startId) {
        const visited = new Set();
        const queue = [startId];
        visited.add(startId);
        while (queue.length > 0) {
            const cur = queue.pop();
            for (const c of this.planets[cur].connections) {
                if (!visited.has(c.targetId)) { visited.add(c.targetId); queue.push(c.targetId); }
            }
        }
        return visited;
    }

    _findComponents() {
        const visited = new Set();
        const components = [];
        for (let i = 0; i < this.planets.length; i++) {
            if (visited.has(i)) continue;
            const comp = [];
            const queue = [i];
            visited.add(i);
            while (queue.length > 0) {
                const cur = queue.pop();
                comp.push(cur);
                for (const c of this.planets[cur].connections) {
                    if (!visited.has(c.targetId)) { visited.add(c.targetId); queue.push(c.targetId); }
                }
                for (let j = 0; j < this.planets.length; j++) {
                    if (j !== cur && !visited.has(j)) {
                        for (const c of this.planets[j].connections) {
                            if (c.targetId === cur) { visited.add(j); queue.push(j); break; }
                        }
                    }
                }
            }
            components.push(comp);
        }
        return components;
    }

    _connectComponents() {
        const comps = this._findComponents();
        for (let i = 0; i < comps.length - 1; i++) {
            let minD = Infinity, pair = null;
            for (const a of comps[i]) {
                for (const b of comps[i + 1]) {
                    const dx = this.planets[a].x - this.planets[b].x;
                    const dy = this.planets[a].y - this.planets[b].y;
                    const d = dx * dx + dy * dy;
                    if (d < minD) { minD = d; pair = [a, b]; }
                }
            }
            if (pair) {
                this.planets[pair[0]].connections.push({ targetId: pair[1], bidirectional: true });
                this.planets[pair[1]].connections.push({ targetId: pair[0], bidirectional: true });
            }
        }
    }

    _ensureBiConnectivity() {
        for (let start = 0; start < this.planets.length; start++) {
            const reachable = this._getReachableFrom(start);
            if (reachable.size === this.planets.length) continue;
            const unreachable = [];
            for (let i = 0; i < this.planets.length; i++) {
                if (!reachable.has(i)) unreachable.push(i);
            }
            let minD = Infinity, pair = null;
            for (const r of reachable) {
                for (const u of unreachable) {
                    const dx = this.planets[r].x - this.planets[u].x;
                    const dy = this.planets[r].y - this.planets[u].y;
                    const d = dx * dx + dy * dy;
                    if (d < minD) { minD = d; pair = [r, u]; }
                }
            }
            if (pair) {
                this.planets[pair[0]].connections.push({ targetId: pair[1], bidirectional: true });
                this.planets[pair[1]].connections.push({ targetId: pair[0], bidirectional: true });
            }
        }
    }

    _validateBiReachability() {
        for (let i = 0; i < this.planets.length; i++) {
            if (this._getReachableFrom(i).size !== this.planets.length) return false;
        }
        return true;
    }

    _validateConns() {
        for (let i = 0; i < this.planets.length; i++) {
            const u = this._getUniqueConnCount(i);
            if (u < 2 || u > 4) return false;
            const p = this.planets[i];
            if (p.connections.length === 0) return false;
            let hasIn = false;
            for (let j = 0; j < this.planets.length && !hasIn; j++) {
                if (j !== i) for (const c of this.planets[j].connections) {
                    if (c.targetId === i) { hasIn = true; break; }
                }
            }
            if (!hasIn) return false;
        }
        return true;
    }

    // ===== REACHABILITY =====
    canTeamReachPlanet(team, targetId) {
        for (const p of this.planets) {
            if (p.team !== team) continue;
            for (const c of p.connections) {
                if (c.targetId === targetId) return true;
            }
        }
        return false;
    }

    getReachablePlanets(team) {
        return this._reachableCache[team];
    }

    _rebuildReachableCache() {
        for (let t = 0; t < 6; t++) this._reachableCache[t].length = 0;
        for (const p of this.planets) {
            if (p.team === 0) continue;
            for (const c of p.connections) {
                this._reachableCache[p.team].push(this.planets[c.targetId]);
            }
        }
        // Dedupe by id
        for (let t = 1; t <= 5; t++) {
            const seen = new Set();
            const arr = this._reachableCache[t];
            let write = 0;
            for (let i = 0; i < arr.length; i++) {
                if (!seen.has(arr[i].id)) { seen.add(arr[i].id); arr[write++] = arr[i]; }
            }
            arr.length = write;
        }
    }

    getPlayerReachablePlanetIds() {
        if (this.settings.aiOnlyMode || teamPlanetCount[1] === 0) {
            const s = new Set();
            for (const p of this.planets) s.add(p.id);
            return s;
        }
        const s = new Set();
        for (const p of this.planets) {
            if (p.team === 1) {
                s.add(p.id);
                for (const c of p.connections) s.add(c.targetId);
            }
        }
        return s;
    }

    // ===== INPUT =====
    setupEventListeners() {
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const wx = (mx - this.camera.x) / this.camera.zoom;
            const wy = (my - this.camera.y) / this.camera.zoom;
            this.camera.zoom = Math.max(0.1, this.camera.zoom * (e.deltaY > 0 ? 0.9 : 1.1));
            this.camera.x = mx - wx * this.camera.zoom;
            this.camera.y = my - wy * this.camera.zoom;
        });

        canvas.addEventListener('mousedown', (e) => {
            if (e.button === 0) {
                this.camera.isDragging = true;
                this.camera.lastMouseX = e.clientX;
                this.camera.lastMouseY = e.clientY;
                this.camera.hasDragged = false;
            }
        });

        canvas.addEventListener('mousemove', (e) => {
            if (this.camera.isDragging) {
                const dx = e.clientX - this.camera.lastMouseX;
                const dy = e.clientY - this.camera.lastMouseY;
                this.camera.x += dx;
                this.camera.y += dy;
                this.camera.lastMouseX = e.clientX;
                this.camera.lastMouseY = e.clientY;
                if (Math.abs(dx) + Math.abs(dy) > 3) this.camera.hasDragged = true;
            }
        });

        canvas.addEventListener('mouseup', (e) => {
            if (e.button === 0) {
                if (!this.camera.hasDragged) this.handleClick(e);
                this.camera.isDragging = false;
                this.camera.hasDragged = false;
            }
        });

        canvas.addEventListener('mouseleave', () => { this.camera.isDragging = false; });

        document.getElementById('restartButton').addEventListener('click', () => location.reload());

        document.getElementById('upgradeAttack').addEventListener('click', () => {
            if (this._spend(1, 'attack', 1)) { recomputeTeamStats(); this.updateUpgradeUI(); }
        });
        document.getElementById('upgradeDefense').addEventListener('click', () => {
            if (this._spend(1, 'defense', 1)) { recomputeTeamStats(); this.updateUpgradeUI(); }
        });
        document.getElementById('upgradeSpeed').addEventListener('click', () => {
            if (this._spend(1, 'speed', 1)) { recomputeTeamStats(); this.updateUpgradeUI(); }
        });
    }

    handleClick(e) {
        if (this.gameOver) return;
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left - this.camera.x) / this.camera.zoom;
        const y = (e.clientY - rect.top - this.camera.y) / this.camera.zoom;

        let clickedPlanet = null;
        for (const p of this.planets) {
            const dx = x - p.x, dy = y - p.y;
            if (dx * dx + dy * dy <= p.size * p.size) { clickedPlanet = p; break; }
        }

        if (clickedPlanet) {
            if (clickedPlanet.team === 1 || !this.canTeamReachPlanet(1, clickedPlanet.id)) return;
        }

        const target = clickedPlanet
            ? { type: 1, idx: clickedPlanet.id, x: clickedPlanet.x, y: clickedPlanet.y, team: clickedPlanet.team }
            : { type: 2, idx: -1, x, y, team: 0 };

        if (e.shiftKey && this.targetPlanets.length < 3) {
            this.targetPlanets.push(target);
        } else {
            this.targetPlanets = [target];
        }

        this._assignPlayerShips();
    }

    _assignPlayerShips() {
        if (this.targetPlanets.length === 0) return;
        // Collect player ship indices
        const indices = [];
        for (let i = 0; i < shipCount; i++) {
            if (shipHealth[i] > 0 && shipTeam[i] === 1) indices.push(i);
        }

        if (this.targetPlanets.length === 1) {
            const t = this.targetPlanets[0];
            for (const idx of indices) {
                shipTargetType[idx] = t.type;
                shipTargetIdx[idx] = t.idx;
                shipTargetPosX[idx] = t.x;
                shipTargetPosY[idx] = t.y;
                shipIsDefending[idx] = 0;
            }
        } else {
            // Round-robin split
            const counts = new Uint16Array(this.targetPlanets.length);
            for (const idx of indices) {
                let minI = 0, minC = counts[0];
                for (let j = 1; j < counts.length; j++) {
                    if (counts[j] < minC) { minC = counts[j]; minI = j; }
                }
                const t = this.targetPlanets[minI];
                shipTargetType[idx] = t.type;
                shipTargetIdx[idx] = t.idx;
                shipTargetPosX[idx] = t.x;
                shipTargetPosY[idx] = t.y;
                shipIsDefending[idx] = 0;
                counts[minI]++;
            }
        }
    }

    // ===== UPDATE =====
    update(dt) {
        if (this.paused || this.gameOver) return;

        recomputeTeamStats();
        recomputeTeamCounts(this.planets);
        this._rebuildReachableCache();

        // Rebuild spatial grid
        this.grid.clear();
        for (let i = 0; i < shipCount; i++) {
            if (shipHealth[i] > 0) this.grid.insert(i, shipX[i], shipY[i]);
        }

        // Calculate combat assignments
        this._calculateCombat();

        // Update planets
        for (let pi = 0; pi < this.planets.length; pi++) {
            const p = this.planets[pi];
            const maxHP = p.getMaxHealth(teamDefenseTokens[p.team]);
            p.health = Math.min(p.health + p.regenRate * teamDefenseLevel[p.team] * dt, maxHP);
            if (p.team !== 0) p.productionTimer += dt;
        }

        // Update ships
        for (let i = 0; i < shipCount; i++) {
            if (shipHealth[i] <= 0) continue;
            this._updateShip(i, dt);
        }

        // Production
        this._updateProduction(dt);

        // AI
        for (let a = 0; a < this.aiControllers.length; a++) {
            this.aiControllers[a].update(dt);
        }

        this._checkWinConditions();
    }

    _calculateCombat() {
        shipCombatTarget.fill(-1);

        // For each ship, find nearest enemy within ATTACK_RANGE using spatial grid
        // Cap at 3 attackers per target
        const assignmentsPerTarget = new Map();

        // Collect pairs (sorted by distance later)
        const pairs = [];

        for (let i = 0; i < shipCount; i++) {
            if (shipHealth[i] <= 0) continue;
            const myTeam = shipTeam[i];
            const sx = shipX[i], sy = shipY[i];
            let bestDist = ATTACK_RANGE_SQ;
            let bestEnemy = -1;

            this.grid.query(sx, sy, ATTACK_RANGE, (j) => {
                if (j === i || shipTeam[j] === myTeam || shipHealth[j] <= 0) return;
                const dx = shipX[j] - sx, dy = shipY[j] - sy;
                const dSq = dx * dx + dy * dy;
                if (dSq < bestDist) { bestDist = dSq; bestEnemy = j; }
            });

            if (bestEnemy >= 0) {
                pairs.push({ ship: i, enemy: bestEnemy, dist: bestDist });
            }
        }

        // Sort closest first, assign max 3 per enemy
        pairs.sort((a, b) => a.dist - b.dist);
        for (let p = 0; p < pairs.length; p++) {
            const enemy = pairs[p].enemy;
            const count = assignmentsPerTarget.get(enemy) || 0;
            if (count < 3) {
                shipCombatTarget[pairs[p].ship] = enemy;
                assignmentsPerTarget.set(enemy, count + 1);
            }
        }
    }

    _updateShip(i, dt) {
        const t = shipTeam[i];

        // Regen
        shipHealth[i] = Math.min(shipHealth[i] + BASE_REGEN * teamDefenseLevel[t] * dt, shipMaxHealth[i]);

        // Attack animation
        if (shipAtkAnimTime[i] > 0) shipAtkAnimTime[i] -= dt;

        // Defense behavior: if defending and home planet lost, stop
        if (shipIsDefending[i]) {
            const hp = shipHomePlanet[i];
            if (hp >= 0 && hp < this.planets.length) {
                const planet = this.planets[hp];
                if (planet.team !== t) {
                    shipIsDefending[i] = 0;
                    shipHomePlanet[i] = -1;
                }
            }
        }

        // Defense: check for threats near home planet
        if (shipIsDefending[i] && shipHomePlanet[i] >= 0) {
            const hp = shipHomePlanet[i];
            const planet = this.planets[hp];
            if (planet.team === t) {
                const defRadius = t === 0 ? 100 : 200;
                const defRadSq = defRadius * defRadius;
                const dxHome = shipX[i] - planet.x, dyHome = shipY[i] - planet.y;
                const distHomeSq = dxHome * dxHome + dyHome * dyHome;

                let nearestThreat = -1, nearestThreatDist = defRadSq;

                this.grid.query(planet.x, planet.y, defRadius, (j) => {
                    if (shipTeam[j] === t || shipTeam[j] === 0 || shipHealth[j] <= 0) return;
                    const dx = shipX[j] - shipX[i], dy = shipY[j] - shipY[i];
                    const dSq = dx * dx + dy * dy;
                    if (dSq < nearestThreatDist) { nearestThreatDist = dSq; nearestThreat = j; }
                });

                if (nearestThreat >= 0 && distHomeSq < (defRadius * 1.5) * (defRadius * 1.5)) {
                    shipTargetType[i] = 0; // clear; combat will handle
                } else if (distHomeSq > (planet.size + 30) * (planet.size + 30)) {
                    shipTargetPosX[i] = planet.x;
                    shipTargetPosY[i] = planet.y;
                    shipTargetType[i] = 2;
                } else {
                    shipTargetType[i] = 0;
                }
            }
        }

        // Combat
        const combatEnemy = shipCombatTarget[i];
        const inCombat = combatEnemy >= 0;

        if (inCombat) {
            shipRot[i] = Math.atan2(shipY[combatEnemy] - shipY[i], shipX[combatEnemy] - shipX[i]);
            if (this.gameTime >= shipNextAttack[i]) {
                this._engageCombat(i, combatEnemy);
                shipNextAttack[i] = this.gameTime + ATTACK_COOLDOWN;
            }
        }

        // Movement
        if (shipTargetType[i] !== 0) {
            const tx = shipTargetPosX[i], ty = shipTargetPosY[i];
            const dx = tx - shipX[i], dy = ty - shipY[i];
            const distSq = dx * dx + dy * dy;
            if (distSq > 25) { // > 5^2
                const invDist = 1 / Math.sqrt(distSq);
                const spd = teamSpeed[t];
                shipVX[i] = dx * invDist * spd;
                shipVY[i] = dy * invDist * spd;
                if (!inCombat) shipRot[i] = Math.atan2(shipVY[i], shipVX[i]);
            } else {
                shipVX[i] = 0;
                shipVY[i] = 0;
            }
        }

        shipX[i] += shipVX[i] * dt;
        shipY[i] += shipVY[i] * dt;

        // Planet collision
        for (let pi = 0; pi < this.planets.length; pi++) {
            const p = this.planets[pi];
            const dx = shipX[i] - p.x, dy = shipY[i] - p.y;
            const distSq = dx * dx + dy * dy;
            const minD = p.size + PLANET_CLEARANCE;
            if (distSq < minD * minD && distSq > 0.01) {
                const dist = Math.sqrt(distSq);
                const inv = minD / dist;
                shipX[i] = p.x + dx * inv;
                shipY[i] = p.y + dy * inv;
            }
        }

        // Ship-ship collision (spatial grid, only nearby)
        this.grid.query(shipX[i], shipY[i], SHIP_SPACING, (j) => {
            if (j === i || shipHealth[j] <= 0) return;
            const dx = shipX[j] - shipX[i], dy = shipY[j] - shipY[i];
            const dSq = dx * dx + dy * dy;
            if (dSq < SHIP_SPACING_SQ && dSq > 0.01) {
                const dist = Math.sqrt(dSq);
                const overlap = SHIP_SPACING - dist;
                const inv = 1 / dist;
                shipX[i] -= dx * inv * (overlap * 0.5);
                shipY[i] -= dy * inv * (overlap * 0.5);
            }
        });

        // Planet attack (drive-by + targeted)
        if (!inCombat) {
            const reachable = this._reachableCache[t];
            if (reachable.length > 0 && this.gameTime >= shipNextAttack[i]) {
                for (let ri = 0; ri < reachable.length; ri++) {
                    const rp = reachable[ri];
                    if (rp.team === t) continue;
                    const dx = shipX[i] - rp.x, dy = shipY[i] - rp.y;
                    if (dx * dx + dy * dy <= ATTACK_RANGE_SQ) {
                        this._attackPlanet(i, rp);
                        shipNextAttack[i] = this.gameTime + ATTACK_COOLDOWN;
                        break;
                    }
                }
            }

            // Targeted planet attack
            if (shipTargetType[i] === 1 && shipTargetIdx[i] >= 0) {
                const tp = this.planets[shipTargetIdx[i]];
                if (tp && tp.team !== t && this.gameTime >= shipNextAttack[i]) {
                    const dx = shipX[i] - tp.x, dy = shipY[i] - tp.y;
                    if (dx * dx + dy * dy <= ATTACK_RANGE_SQ) {
                        this._attackPlanet(i, tp);
                        shipNextAttack[i] = this.gameTime + ATTACK_COOLDOWN;
                    }
                }
            }
        }
    }

    _engageCombat(a, b) {
        shipAtkAnimTime[a] = 0.2;
        shipAtkTargetX[a] = shipX[b];
        shipAtkTargetY[a] = shipY[b];
        shipAtkAnimTime[b] = 0.2;
        shipAtkTargetX[b] = shipX[a];
        shipAtkTargetY[b] = shipY[a];

        // A attacks B
        this._dealDamage(a, b);
        if (shipHealth[b] > 0) this._dealDamage(b, a);
    }

    _dealDamage(attacker, target) {
        const atk = teamAttack[shipTeam[attacker]];
        const def = teamDefense[shipTeam[target]];
        const base = atk * 0.5;
        const reduction = def / (def + 50);
        const dmg = base * (1 - reduction * 0.5);
        shipHealth[target] -= dmg;
        if (shipHealth[target] <= 0) {
            this.awardPoints(shipTeam[attacker], this.POINTS_PER_SHIP);
            killShip(target);
        }
    }

    _attackPlanet(shipIdx, planet) {
        shipAtkAnimTime[shipIdx] = 0.2;
        shipAtkTargetX[shipIdx] = planet.x;
        shipAtkTargetY[shipIdx] = planet.y;

        const atk = teamAttack[shipTeam[shipIdx]];
        const damage = atk * 0.5;
        planet.health -= damage;

        if (planet.health <= 0) {
            const attackerTeam = shipTeam[shipIdx];
            // Check reachability
            if (teamPlanetCount[attackerTeam] > 0 && !this.canTeamReachPlanet(attackerTeam, planet.id)) {
                planet.health = 1;
                return;
            }
            const oldTeam = planet.team;
            planet.team = attackerTeam;
            planet.health = planet.getMaxHealth(teamDefenseTokens[attackerTeam]) * 0.75;
            planet.productionTimer = 0;
            if (oldTeam !== attackerTeam) this.awardPoints(attackerTeam, this.POINTS_PER_PLANET);
        }
    }

    _updateProduction(dt) {
        for (let pi = 0; pi < this.planets.length; pi++) {
            const p = this.planets[pi];
            if (p.team === 0) {
                // Neutral: cap per planet
                let count = 0;
                for (let i = 0; i < shipCount; i++) {
                    if (shipHealth[i] > 0 && shipTeam[i] === 0 && shipHomePlanet[i] === p.id) count++;
                }
                if (count < STARTING_SHIPS && p.productionTimer >= PRODUCTION_INTERVAL) {
                    this.spawnShipAtPlanet(p);
                    p.productionTimer = 0;
                }
                continue;
            }

            const maxFleet = this.getMaxFleet(p.team);
            if (teamShipCount[p.team] >= maxFleet) continue;

            const defTokens = teamDefenseTokens[p.team];
            const prodBonus = defTokens * PRODUCTION_SPEED_PER_DEFENSE_TOKEN;
            const effectiveInterval = PRODUCTION_INTERVAL * (1 - prodBonus);

            if (p.productionTimer >= effectiveInterval) {
                this.spawnShipAtPlanet(p);
                p.productionTimer = 0;
                teamShipCount[p.team]++; // update count to avoid over-spawning this frame
            }
        }
    }

    _checkWinConditions() {
        // Fast check using cached counts
        let activePlanetTeams = 0, hasNeutralPlanets = false;
        let singlePlanetTeam = -1;
        for (let t = 0; t <= 5; t++) {
            if (teamPlanetCount[t] > 0) {
                if (t === 0) hasNeutralPlanets = true;
                else { activePlanetTeams++; singlePlanetTeam = t; }
            }
        }

        let activeShipTeams = 0;
        for (let t = 1; t <= 5; t++) {
            if (teamShipCount[t] > 0) activeShipTeams++;
        }

        if (activePlanetTeams === 1 && !hasNeutralPlanets) {
            // Check no enemy ships alive
            let enemyAlive = false;
            for (let t = 1; t <= 5; t++) {
                if (t !== singlePlanetTeam && teamShipCount[t] > 0) { enemyAlive = true; break; }
            }
            if (!enemyAlive) {
                this.gameOver = true;
                this.winner = singlePlanetTeam;
            }
        } else if (activeShipTeams === 0 && activePlanetTeams === 0 && hasNeutralPlanets) {
            this.gameOver = true;
            this.winner = 0;
        }

        if (this.gameOver) {
            if (this.settings.aiOnlyMode && this.settings.batchTestMode) {
                this._handleBatchCompletion();
            } else if (this.settings.aiOnlyMode && this.settings.idleMode) {
                setTimeout(() => { this.stopped = true; startGame(); }, 100);
            } else if (!this.settings.aiOnlyMode) {
                this._showGameOver();
            }
        }
    }

    _showGameOver() {
        const screen = document.getElementById('gameOverScreen');
        const title = document.getElementById('gameOverTitle');
        const message = document.getElementById('gameOverMessage');
        if (this.winner === 1) {
            title.textContent = '🎉 Victory!';
            title.style.color = TEAM_COLORS[1];
            message.textContent = 'You have conquered the galaxy!';
        } else {
            title.textContent = '💀 Defeat';
            title.style.color = TEAM_COLORS[this.winner];
            message.textContent = `${TEAM_NAMES[this.winner]} has conquered the galaxy.`;
        }
        screen.classList.remove('hidden');
    }

    _handleBatchCompletion() {
        if (!window.batchTestResults) window.batchTestResults = [];
        const dur = (Date.now() - this.gameStartTime) / 1000;
        window.batchTestResults.push({
            gameNumber: window.currentTestGame,
            winner: TEAM_NAMES[this.winner],
            winnerIdx: this.winner,
            duration: dur,
            finalPlanets: teamPlanetCount[this.winner]
        });
        console.log(`[BATCH ${window.currentTestGame}/${window.totalTestGames}] Winner: ${TEAM_NAMES[this.winner]}, Duration: ${dur.toFixed(1)}s`);
        if (window.currentTestGame < window.totalTestGames) {
            window.currentTestGame++;
            setTimeout(() => { this.stopped = true; startGame(); }, 100);
        } else {
            this._showBatchResults();
        }
    }

    _showBatchResults() {
        console.log('\n=== BATCH TEST RESULTS ===');
        const wins = {};
        let total = 0;
        for (const r of window.batchTestResults) {
            wins[r.winner] = (wins[r.winner] || 0) + 1;
            total += r.duration;
        }
        for (const t in wins) {
            console.log(`  ${t}: ${wins[t]} wins (${((wins[t] / window.totalTestGames) * 100).toFixed(1)}%)`);
        }
        console.log(`Avg duration: ${(total / window.totalTestGames).toFixed(1)}s`);
        const blob = new Blob([JSON.stringify({ totalGames: window.totalTestGames, wins, games: window.batchTestResults }, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `batch_${Date.now()}.json`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        alert('Batch testing complete! Results saved.');
        window.batchTestResults = [];
    }

    // ===== UPGRADE UI =====
    updateUpgradeUI() {
        const cost = this.getTokenCost(1);
        const pct = (teamPoints[1] / cost) * 100;
        document.getElementById('progressBar').style.width = pct + '%';
        document.getElementById('playerTokens').textContent = teamTokens[1];
        document.getElementById('attackValue').textContent = teamAttackTokens[1];
        document.getElementById('defenseValue').textContent = teamDefenseTokens[1];
        document.getElementById('speedValue').textContent = teamSpeedTokens[1];

        const has = teamTokens[1] > 0;
        document.getElementById('tokenDisplay').classList.toggle('hidden', !has);

        const btns = ['upgradeAttack', 'upgradeDefense', 'upgradeSpeed'];
        for (const id of btns) {
            const el = document.getElementById(id);
            el.disabled = !has;
            el.classList.toggle('opacity-50', !has);
            el.classList.toggle('cursor-not-allowed', !has);
        }
    }

    // ===== RENDER =====
    render() {
        if (this.useWebGL) this._renderWebGL();
        else this._renderCanvas2D();

        if (this.frameCount % 5 === 0) {
            this._updateStatsUI();
            this.updateUpgradeUI();
        }
    }

    _renderWebGL() {
        const r = this.renderer;
        r.setCamera(this.camera.x, this.camera.y, this.camera.zoom);
        r.clear();

        // Clear overlay canvas for 2D text/rings
        ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

        // --- Connection lines ---
        const drawnPairs = new Set();
        let lineCount = 0;
        const lp = r._linePositions;
        const lc = r._lineColors;

        for (let pi = 0; pi < this.planets.length; pi++) {
            const p = this.planets[pi];
            for (let ci = 0; ci < p.connections.length; ci++) {
                const conn = p.connections[ci];
                const tp = this.planets[conn.targetId];
                if (!tp) continue;

                if (conn.bidirectional) {
                    const key = Math.min(p.id, tp.id) * 10000 + Math.max(p.id, tp.id);
                    if (drawnPairs.has(key)) continue;
                    drawnPairs.add(key);
                }

                const angle = Math.atan2(tp.y - p.y, tp.x - p.x);
                const cos = Math.cos(angle), sin = Math.sin(angle);

                const off = lineCount * 4;
                lp[off] = p.x + cos * (p.size + 5);
                lp[off + 1] = p.y + sin * (p.size + 5);
                lp[off + 2] = tp.x - cos * (tp.size + 5);
                lp[off + 3] = tp.y - sin * (tp.size + 5);

                const rgba = conn.bidirectional ? this._connBiRGBA : this._connUniRGBA;
                const coff = lineCount * 8;
                lc[coff] = rgba[0]; lc[coff + 1] = rgba[1]; lc[coff + 2] = rgba[2]; lc[coff + 3] = 0.6;
                lc[coff + 4] = rgba[0]; lc[coff + 5] = rgba[1]; lc[coff + 6] = rgba[2]; lc[coff + 7] = 0.6;
                lineCount++;
            }
        }
        r.renderLines(lineCount);

        // --- Planets ---
        const reachableIds = this.getPlayerReachablePlanetIds();
        const cd = r._circleData;
        let circleCount = 0;
        for (let pi = 0; pi < this.planets.length; pi++) {
            const p = this.planets[pi];
            const off = circleCount * 5;
            cd[off] = p.x;
            cd[off + 1] = p.y;
            cd[off + 2] = p.size;
            cd[off + 3] = this._colorIndices[p.team];
            cd[off + 4] = (this.settings.aiOnlyMode || reachableIds.has(p.id)) ? 1.0 : 0.3;
            circleCount++;
        }
        r.renderCircles(circleCount);

        // --- Ships ---
        const sd = r._shipData;
        let sCount = 0;
        for (let i = 0; i < shipCount; i++) {
            if (shipHealth[i] <= 0) continue;
            const off = sCount * 5;
            sd[off] = shipX[i];
            sd[off + 1] = shipY[i];
            sd[off + 2] = shipRot[i];
            sd[off + 3] = this._colorIndices[shipTeam[i]];
            sd[off + 4] = 1.0;
            sCount++;
        }
        r.renderShips(sCount);

        // --- Attack beams ---
        lineCount = 0;
        for (let i = 0; i < shipCount; i++) {
            if (shipHealth[i] <= 0 || shipAtkAnimTime[i] <= 0) continue;
            const off = lineCount * 4;
            lp[off] = shipX[i];
            lp[off + 1] = shipY[i];
            lp[off + 2] = shipAtkTargetX[i];
            lp[off + 3] = shipAtkTargetY[i];

            const ci = this._colorIndices[shipTeam[i]];
            const cr = r.colorPalette[ci * 4], cg = r.colorPalette[ci * 4 + 1], cb = r.colorPalette[ci * 4 + 2];
            const alpha = shipAtkAnimTime[i] / 0.2;
            const coff = lineCount * 8;
            lc[coff] = cr; lc[coff + 1] = cg; lc[coff + 2] = cb; lc[coff + 3] = alpha;
            lc[coff + 4] = cr; lc[coff + 5] = cg; lc[coff + 6] = cb; lc[coff + 7] = alpha;
            lineCount++;
        }
        r.renderLines(lineCount);

        // --- Target selection circles (Canvas2D overlay for dashed lines) ---
        if (this.targetPlanets.length > 0) {
            ctx.save();
            ctx.translate(this.camera.x, this.camera.y);
            ctx.scale(this.camera.zoom, this.camera.zoom);
            for (const t of this.targetPlanets) {
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2 / this.camera.zoom;
                ctx.setLineDash([5 / this.camera.zoom, 5 / this.camera.zoom]);
                ctx.beginPath();
                ctx.arc(t.x, t.y, 15, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
            }
            ctx.restore();
        }

        // --- Planet HP text (Canvas2D overlay) ---
        ctx.save();
        ctx.translate(this.camera.x, this.camera.y);
        ctx.scale(this.camera.zoom, this.camera.zoom);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let pi = 0; pi < this.planets.length; pi++) {
            const p = this.planets[pi];
            ctx.globalAlpha = (!this.settings.aiOnlyMode && !reachableIds.has(p.id)) ? 0.3 : 1;
            ctx.fillText(Math.ceil(p.health).toString(), p.x, p.y);

            // Health ring
            const maxHP = p.getMaxHealth(teamDefenseTokens[p.team]);
            const hpPct = p.health / maxHP;
            const ringR = p.size * 0.85;
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(p.x, p.y, ringR, 0, Math.PI * 2);
            ctx.stroke();
            ctx.strokeStyle = TEAM_COLORS[p.team];
            ctx.beginPath();
            ctx.arc(p.x, p.y, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hpPct);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.restore();
    }

    _renderCanvas2D() {
        ctx.fillStyle = '#0a0e27';
        ctx.fillRect(0, 0, overlayCanvas.width, overlayCanvas.height);

        ctx.save();
        ctx.translate(this.camera.x, this.camera.y);
        ctx.scale(this.camera.zoom, this.camera.zoom);

        // Grid
        ctx.strokeStyle = '#1a1e3a';
        ctx.lineWidth = 1 / this.camera.zoom;
        const gs = -this.camera.x / this.camera.zoom;
        const ge = (overlayCanvas.width - this.camera.x) / this.camera.zoom;
        for (let i = Math.floor(gs / 50) * 50; i < ge; i += 50) {
            ctx.beginPath(); ctx.moveTo(i, -this.camera.y / this.camera.zoom);
            ctx.lineTo(i, (overlayCanvas.height - this.camera.y) / this.camera.zoom); ctx.stroke();
        }
        const gsy = -this.camera.y / this.camera.zoom;
        const gey = (overlayCanvas.height - this.camera.y) / this.camera.zoom;
        for (let i = Math.floor(gsy / 50) * 50; i < gey; i += 50) {
            ctx.beginPath(); ctx.moveTo(-this.camera.x / this.camera.zoom, i);
            ctx.lineTo((overlayCanvas.width - this.camera.x) / this.camera.zoom, i); ctx.stroke();
        }

        // Connections
        const drawnPairs2 = new Set();
        for (const p of this.planets) {
            for (const conn of p.connections) {
                const tp = this.planets[conn.targetId];
                if (!tp) continue;
                if (conn.bidirectional) {
                    const key = Math.min(p.id, tp.id) * 10000 + Math.max(p.id, tp.id);
                    if (drawnPairs2.has(key)) continue;
                    drawnPairs2.add(key);
                }
                const angle = Math.atan2(tp.y - p.y, tp.x - p.x);
                ctx.strokeStyle = conn.bidirectional ? '#4a5568' : '#2d3748';
                ctx.lineWidth = conn.bidirectional ? 2 : 1.5;
                ctx.globalAlpha = 0.6;
                ctx.beginPath();
                ctx.moveTo(p.x + Math.cos(angle) * (p.size + 5), p.y + Math.sin(angle) * (p.size + 5));
                ctx.lineTo(tp.x - Math.cos(angle) * (tp.size + 5), tp.y - Math.sin(angle) * (tp.size + 5));
                ctx.stroke();
                ctx.globalAlpha = 1;
            }
        }

        // Planets
        const reachableIds = this.getPlayerReachablePlanetIds();
        for (const p of this.planets) {
            const isDimmed = !this.settings.aiOnlyMode && !reachableIds.has(p.id);
            const color = TEAM_COLORS[p.team];
            ctx.globalAlpha = isDimmed ? 0.3 : 1;

            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * 0.7, 0, Math.PI * 2);
            ctx.fill();

            const maxHP = p.getMaxHealth(teamDefenseTokens[p.team]);
            const hpPct = p.health / maxHP;
            const ringR = p.size * 0.85;
            ctx.strokeStyle = '#333'; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.arc(p.x, p.y, ringR, 0, Math.PI * 2); ctx.stroke();
            ctx.strokeStyle = color; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.arc(p.x, p.y, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hpPct); ctx.stroke();

            ctx.fillStyle = '#ffffff'; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(Math.ceil(p.health).toString(), p.x, p.y);

            if (isDimmed) ctx.globalAlpha = 1;
        }

        // Ships
        for (let i = 0; i < shipCount; i++) {
            if (shipHealth[i] <= 0) continue;
            const color = TEAM_COLORS[shipTeam[i]];

            if (shipAtkAnimTime[i] > 0) {
                ctx.save();
                ctx.strokeStyle = color; ctx.lineWidth = 2;
                ctx.globalAlpha = shipAtkAnimTime[i] / 0.2;
                ctx.beginPath();
                ctx.moveTo(shipX[i], shipY[i]);
                ctx.lineTo(shipAtkTargetX[i], shipAtkTargetY[i]);
                ctx.stroke();
                ctx.globalAlpha = 1;
                ctx.restore();
            }

            ctx.save();
            ctx.translate(shipX[i], shipY[i]);
            ctx.rotate(shipRot[i]);
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(6, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4);
            ctx.closePath(); ctx.fill();
            ctx.restore();
        }

        // Target indicators
        for (const t of this.targetPlanets) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2 / this.camera.zoom;
            ctx.setLineDash([5 / this.camera.zoom, 5 / this.camera.zoom]);
            ctx.beginPath();
            ctx.arc(t.x, t.y, 15, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        ctx.restore();
    }

    _updateStatsUI() {
        const statsDiv = document.getElementById('teamStats');
        const batchCounter = document.getElementById('batchRoundCounter');

        if (this.settings.batchTestMode && window.currentTestGame) {
            batchCounter.classList.remove('hidden');
            batchCounter.textContent = `🧪 Round ${window.currentTestGame} / ${window.totalTestGames}`;
        } else {
            batchCounter.classList.add('hidden');
        }

        let html = '';
        for (let t = 1; t <= 5; t++) {
            const planets = teamPlanetCount[t];
            const ships = teamShipCount[t];
            if (planets === 0 && ships === 0) continue;
            const maxFleet = this.getMaxFleet(t);
            const color = TEAM_COLORS[t];
            const points = Math.floor(teamPoints[t]);
            html += `<div style="color:${color}"><strong>${TEAM_NAMES[t]}:</strong> ${planets} planets, ${ships}/${maxFleet} ships<br><span style="opacity:0.7;font-size:0.85em">⚔️${teamAttackTokens[t]} 🛡️${teamDefenseTokens[t]} ⚡${teamSpeedTokens[t]} | 💰${points} pts</span></div>`;
        }
        statsDiv.innerHTML = html;
    }

    // ===== GAME LOOP =====
    gameLoop() {
        if (this.stopped) return;
        const now = Date.now();
        const wallDt = Math.min((now - this.lastTime) / 1000, 0.1);
        this.lastTime = now;

        const speed = this.settings.speedMultiplier || 1;
        const FIXED_DT = 1 / 60;
        const maxSteps = Math.ceil(speed * 10);

        this.accumulator += wallDt * speed;

        let steps = 0;
        while (this.accumulator >= FIXED_DT && steps < maxSteps) {
            this.update(FIXED_DT);
            this.gameTime += FIXED_DT;
            this.accumulator -= FIXED_DT;
            steps++;
            if (this.gameOver) break;
        }

        if (speed <= 1) {
            this.render();
            this.frameCount++;
        } else {
            this.frameCount++;
            if (this.frameCount % 60 === 0) this._updateStatsUI();
        }

        requestAnimationFrame(() => this.gameLoop());
    }
}

// ===== START MENU / PAUSE =====
let game = null;

function initializeStartMenu() {
    const galaxySize = document.getElementById('galaxySize');
    const playerCount = document.getElementById('playerCount');
    const aiDifficulty = document.getElementById('aiDifficulty');
    const aiOnlyMode = document.getElementById('aiOnlyMode');
    const idleModeOption = document.getElementById('idleModeOption');
    const idleMode = document.getElementById('idleMode');
    const batchTestOptions = document.getElementById('batchTestOptions');
    const batchTestMode = document.getElementById('batchTestMode');
    const batchTestConfig = document.getElementById('batchTestConfig');
    const batchTestCount = document.getElementById('batchTestCount');
    const speedMultiplier = document.getElementById('speedMultiplier');
    const startButton = document.getElementById('startGameButton');
    const warning = document.getElementById('playerCountWarning');
    const controlsButton = document.getElementById('controlsButton');
    const controlsModal = document.getElementById('controlsModal');
    const closeControlsButton = document.getElementById('closeControlsButton');

    if (!DEBUG) {
        const tsc = document.getElementById('teamStatsContainer');
        if (tsc) tsc.style.display = 'none';
    }

    controlsButton.addEventListener('click', () => controlsModal.classList.remove('hidden'));
    closeControlsButton.addEventListener('click', () => {
        controlsModal.classList.add('hidden');
        if (game && game.paused) document.getElementById('pauseMenu').classList.remove('hidden');
        else if (game) document.getElementById('ui').classList.remove('hidden');
    });

    batchTestMode.checked = false;
    batchTestCount.value = 10;
    speedMultiplier.value = 1;
    batchTestConfig.classList.add('hidden');

    if (aiOnlyMode.checked && DEBUG) {
        batchTestOptions.style.display = 'block';
        batchTestOptions.classList.remove('hidden');
    }

    aiOnlyMode.addEventListener('change', () => {
        idleModeOption.classList.toggle('hidden', !aiOnlyMode.checked);
        if (aiOnlyMode.checked && DEBUG) {
            batchTestOptions.style.display = 'block';
            batchTestOptions.classList.remove('hidden');
        } else {
            batchTestOptions.style.display = 'none';
            batchTestOptions.classList.add('hidden');
            batchTestMode.checked = false;
            batchTestConfig.classList.add('hidden');
        }
    });

    idleModeOption.classList.toggle('hidden', !aiOnlyMode.checked);

    batchTestMode.addEventListener('change', () => {
        batchTestConfig.classList.toggle('hidden', !batchTestMode.checked);
    });

    function validate() {
        const maxP = { small: 3, medium: 4, large: 5, huge: 5 };
        const ok = parseInt(playerCount.value) <= (maxP[galaxySize.value] || 5);
        warning.classList.toggle('hidden', ok);
        startButton.disabled = !ok;
        startButton.classList.toggle('opacity-50', !ok);
        startButton.classList.toggle('cursor-not-allowed', !ok);
        return ok;
    }

    galaxySize.addEventListener('change', validate);
    playerCount.addEventListener('change', validate);

    startButton.addEventListener('click', () => {
        if (!validate()) return;
        const settings = {
            galaxySize: galaxySize.value,
            playerCount: parseInt(playerCount.value),
            aiPointsMultiplier: parseFloat(aiDifficulty.value),
            aiOnlyMode: aiOnlyMode.checked,
            idleMode: aiOnlyMode.checked && idleMode.checked,
            batchTestMode: aiOnlyMode.checked && batchTestMode.checked,
            speedMultiplier: (aiOnlyMode.checked && batchTestMode.checked) ? (parseInt(speedMultiplier.value) || 10) : 1
        };
        if (settings.idleMode) {
            const url = new URL(window.location);
            url.searchParams.set('idle', '1');
            url.searchParams.set('size', settings.galaxySize);
            url.searchParams.set('teams', settings.playerCount);
            url.searchParams.set('difficulty', aiDifficulty.value);
            window.history.replaceState({}, '', url);
        }
        if (settings.batchTestMode) {
            window.totalTestGames = parseInt(batchTestCount.value) || 10;
            window.currentTestGame = 1;
            window.batchTestResults = [];
        }
        document.getElementById('startMenu').classList.add('hidden');
        document.getElementById('ui').classList.remove('hidden');
        if (settings.aiOnlyMode) document.getElementById('upgradePanel').classList.add('hidden');
        game = new Game(settings);
    });

    const params = new URLSearchParams(window.location.search);
    if (params.get('size')) {
        galaxySize.value = params.get('size');
        galaxySize.dispatchEvent(new Event('change'));
    }
    if (params.get('teams')) {
        playerCount.value = params.get('teams');
        playerCount.dispatchEvent(new Event('change'));
    }
    if (params.get('difficulty')) {
        aiDifficulty.value = params.get('difficulty');
        aiDifficulty.dispatchEvent(new Event('change'));
    }

    if (params.get('idle') === '1') {
        aiOnlyMode.checked = true;
        aiOnlyMode.dispatchEvent(new Event('change'));
        idleMode.checked = true;
        validate();
        startButton.click();
    } else {
        validate();
    }
}

function startGame() {
    const settings = {
        galaxySize: document.getElementById('galaxySize').value,
        playerCount: parseInt(document.getElementById('playerCount').value),
        aiPointsMultiplier: parseFloat(document.getElementById('aiDifficulty').value),
        aiOnlyMode: document.getElementById('aiOnlyMode').checked,
        idleMode: document.getElementById('aiOnlyMode').checked && document.getElementById('idleMode').checked,
        batchTestMode: document.getElementById('batchTestMode').checked,
        speedMultiplier: document.getElementById('batchTestMode').checked ? (parseInt(document.getElementById('speedMultiplier').value) || 10) : 1
    };
    game = new Game(settings);
}

function setupPauseMenu() {
    const pauseButton = document.getElementById('pauseButton');
    const pauseMenu = document.getElementById('pauseMenu');
    const resumeButton = document.getElementById('resumeButton');
    const pauseExitButton = document.getElementById('pauseExitButton');
    const pauseControlsButton = document.getElementById('pauseControlsButton');
    const controlsModal = document.getElementById('controlsModal');

    pauseButton.addEventListener('click', () => {
        if (game) { game.paused = true; pauseMenu.classList.remove('hidden'); document.getElementById('ui').classList.add('hidden'); }
    });
    resumeButton.addEventListener('click', () => {
        if (game) { game.paused = false; pauseMenu.classList.add('hidden'); document.getElementById('ui').classList.remove('hidden'); }
    });
    pauseExitButton.addEventListener('click', () => {
        const url = new URL(window.location);
        url.searchParams.delete('idle');
        window.location.href = url.toString();
    });
    pauseControlsButton.addEventListener('click', () => {
        pauseMenu.classList.add('hidden');
        controlsModal.classList.remove('hidden');
    });

    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && game && !game.gameOver) {
            e.preventDefault();
            if (game.paused) {
                game.paused = false; pauseMenu.classList.add('hidden');
                document.getElementById('ui').classList.remove('hidden');
            } else {
                game.paused = true; pauseMenu.classList.remove('hidden');
                document.getElementById('ui').classList.add('hidden');
            }
        }
    });
}

initializeStartMenu();
setupPauseMenu();
