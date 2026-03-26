const DEBUG = true;

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});

const TEAM_COLORS = {
    neutral: '#888888',
    team1: '#4ade80',
    team2: '#f87171',
    team3: '#60a5fa',
    team4: '#fbbf24',
    team5: '#c084fc'
};

const TEAM_NAMES = {
    neutral: 'Neutral',
    team1: 'Green Alliance',
    team2: 'Red Empire',
    team3: 'Blue Federation',
    team4: 'Gold Collective',
    team5: 'Purple Dynasty'
};

const BASE_CAP = 20;
const CAP_AMNT = 15;
const BASE_REGEN = 0.5;
const BASE_PLANET_REGEN = 2;
const ATTACK_COOLDOWN = 1.0;
const ATTACK_RANGE = 50;
const SHIP_SPEED = 80;
const PRODUCTION_INTERVAL = 2.0;
const SHIP_RADIUS = 5;
const SHIP_SPACING = 10;
const PLANET_CLEARANCE = 15;
const STARTING_SHIPS = 10;
const MAX_CONNECTION_DISTANCE = 300;

const BASE_ATTACK = 10;
const BASE_DEFENSE = 10;
const BASE_SPEED = 80;

const ATTACK_PER_TOKEN = 5;
const DEFENSE_PER_TOKEN = 5;
const SPEED_PER_TOKEN = 10;

class Vector2 {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }

    static distance(a, b) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    static normalize(v) {
        const len = Math.sqrt(v.x * v.x + v.y * v.y);
        if (len === 0) return { x: 0, y: 0 };
        return { x: v.x / len, y: v.y / len };
    }

    static subtract(a, b) {
        return { x: a.x - b.x, y: a.y - b.y };
    }
}

class Planet {
    constructor(id, x, y, team, baseHealth, productionRate, capacityContribution, game = null) {
        this.id = id;
        this.team = team;
        this.position = { x, y };
        this.baseHealth = baseHealth;
        this.game = game;
        this.productionRate = productionRate;
        this.capacityContribution = capacityContribution;
        this.regenRate = BASE_PLANET_REGEN;
        this.productionTimer = 0;
        this.size = 20 + (baseHealth / 50);
        this.connections = [];
        this.health = this.getMaxHealth();
    }

    getMaxHealth() {
        if (!this.game || this.team === 'neutral') {
            return this.baseHealth;
        }
        const defense = this.game.getTeamDefense(this.team);
        return this.baseHealth + (defense * 5);
    }

    get maxHealth() {
        return this.getMaxHealth();
    }

    addConnection(targetPlanetId, bidirectional = false) {
        this.connections.push({ targetId: targetPlanetId, bidirectional });
    }

    canAttack(targetPlanetId) {
        return this.connections.some(conn => conn.targetId === targetPlanetId);
    }

    update(dt, teamDefenseLevel) {
        this.health = Math.min(this.health + this.regenRate * teamDefenseLevel * dt, this.maxHealth);

        if (this.team !== 'neutral') {
            this.productionTimer += dt;
        }
    }

    takeDamage(damage, attackerTeam, game) {
    this.health -= damage;
    if (this.health <= 0) {
        const attackerPlanets = game ? game.planets.filter(p => p.team === attackerTeam).length : 0;
        if (game && attackerPlanets > 0 && !game.canTeamReachPlanet(attackerTeam, this.id)) {
            this.health = 1;
            return false;
        }

            const oldTeam = this.team;
            this.team = attackerTeam;
            this.health = this.maxHealth * 0.75;
            this.productionTimer = 0;

            if (game && oldTeam !== attackerTeam) {
                game.awardPoints(attackerTeam, game.POINTS_PER_PLANET);
            }

            return true;
        }
        return false;
    }

    draw(ctx, isSelected = false, isDimmed = false) {
        const color = TEAM_COLORS[this.team];

        if (isDimmed) {
            ctx.globalAlpha = 0.3;
        }

        if (isSelected) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(this.position.x, this.position.y, this.size + 10, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(this.position.x, this.position.y, this.size * 0.7, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        const originalAlpha = ctx.globalAlpha;
        ctx.globalAlpha = isDimmed ? 0.15 : 0.3;
        ctx.beginPath();
        ctx.arc(this.position.x, this.position.y, this.size * 0.7 + 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = originalAlpha;

        const healthPercent = this.health / this.maxHealth;
        const ringRadius = this.size * 0.85;
        const ringWidth = 4;

        ctx.strokeStyle = '#333';
        ctx.lineWidth = ringWidth;
        ctx.beginPath();
        ctx.arc(this.position.x, this.position.y, ringRadius, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = color;
        ctx.lineWidth = ringWidth;
        ctx.beginPath();
        ctx.arc(this.position.x, this.position.y, ringRadius, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * healthPercent));
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const hpText = Math.ceil(this.health).toString();
        ctx.fillText(hpText, this.position.x, this.position.y);

        if (isDimmed) {
            ctx.globalAlpha = 1;
        }
    }
}

class Ship {
    constructor(id, team, x, y, game, homePlanet = null) {
        this.id = id;
        this.team = team;
        this.position = { x, y };
        this.velocity = { x: 0, y: 0 };
        this.target = null;
        this.health = 100;
        this.maxHealth = 100;
        this.game = game;
        this.attackCooldown = ATTACK_COOLDOWN;
        this.nextAttackTime = 0;
        this.regenRate = BASE_REGEN;
        this.rotation = 0;
        this.homePlanet = homePlanet;
        this.isDefending = true;
        this.attackTarget = null;
        this.attackAnimationTime = 0;
    }

    get attack() {
        return this.game.getTeamAttack(this.team);
    }

    get defense() {
        return this.game.getTeamDefense(this.team);
    }

    get speed() {
        return this.game.getTeamSpeed(this.team);
    }

    update(dt, planets, ships, teamDefenseLevel, game) {
        // If homePlanet is gone or captured, stop defending
        if (this.isDefending && this.homePlanet && this.homePlanet.team !== this.team) {
            this.isDefending = false;
            this.homePlanet = null;
        }

        this.health = Math.min(this.health + this.regenRate * teamDefenseLevel * dt, this.maxHealth);

        if (this.attackAnimationTime > 0) {
            this.attackAnimationTime -= dt;
            if (this.attackAnimationTime <= 0) {
                this.attackTarget = null;
            }
        }

        if (this.isDefending && this.homePlanet && this.homePlanet.team === this.team) {
            const defenseRadius = this.team === 'neutral' ? 100 : 200;
            const distanceFromHome = Vector2.distance(this.position, this.homePlanet.position);
            let nearestThreat = null;
            let minThreatDist = defenseRadius;

            for (const ship of ships) {
                if (ship.team !== this.team && ship.health > 0) {
                    const distToPlanet = Vector2.distance(ship.position, this.homePlanet.position);
                    if (distToPlanet < defenseRadius) {
                        const distToThreat = Vector2.distance(this.position, ship.position);
                        if (distToThreat < minThreatDist) {
                            minThreatDist = distToThreat;
                            nearestThreat = ship;
                        }
                    }
                }
            }

            if (nearestThreat && distanceFromHome < defenseRadius * 1.5) {
                this.target = nearestThreat;
            } else if (distanceFromHome > this.homePlanet.size + 30) {
                this.target = { position: this.homePlanet.position, team: this.team };
            } else {
                this.target = null;
            }
        }

        const nearbyEnemyShip = this.findNearestEnemyShip(ships);
        const isInCombat = nearbyEnemyShip && Vector2.distance(this.position, nearbyEnemyShip.position) <= ATTACK_RANGE;

        if (isInCombat) {
            this.rotation = Math.atan2(
                nearbyEnemyShip.position.y - this.position.y,
                nearbyEnemyShip.position.x - this.position.x
            );

            if (Date.now() / 1000 >= this.nextAttackTime) {
                this.engageCombat(nearbyEnemyShip, game);
                this.nextAttackTime = Date.now() / 1000 + this.attackCooldown;
            }
        }

        if (this.target) {
            const targetPos = this.target.position;
            const distance = Vector2.distance(this.position, targetPos);

            if (distance > 5) {
                const direction = Vector2.normalize(Vector2.subtract(targetPos, this.position));
                this.velocity.x = direction.x * this.speed;
                this.velocity.y = direction.y * this.speed;

                if (!isInCombat) {
                    this.rotation = Math.atan2(this.velocity.y, this.velocity.x);
                }
            } else {
                this.velocity.x = 0;
                this.velocity.y = 0;
            }
        }

        const newX = this.position.x + this.velocity.x * dt;
        const newY = this.position.y + this.velocity.y * dt;

        this.position.x = newX;
        this.position.y = newY;

        this.resolveCollisions(planets, ships);

        if (!isInCombat && this.target && (this.target.team !== this.team && this.target.team !== 'neutral' ||
                   (this.target instanceof Planet && this.target.team === 'neutral'))) {
            if (this.target instanceof Planet && !game.canTeamReachPlanet(this.team, this.target.id)) {
                const hasAnyPlanet = game.planets.some(p => p.team === this.team);
                if (hasAnyPlanet) {
                    const reachable = game.getReachablePlanets(this.team).filter(p => p.team !== this.team);
                    if (reachable.length > 0) {
                        reachable.sort((a, b) =>
                            Vector2.distance(this.position, a.position) -
                            Vector2.distance(this.position, b.position)
                        );
                        this.target = reachable[0];
                        this.isDefending = false;
                    } else {
                        this.target = null;
                        this.isDefending = true;
                    }
                    return;
                }
            }

            const distanceToTarget = Vector2.distance(this.position, this.target.position);
            if (distanceToTarget <= ATTACK_RANGE) {
                if (Date.now() / 1000 >= this.nextAttackTime) {
                    if (this.target instanceof Planet) {
                        this.attackPlanet(this.target, game);
                    }
                    this.nextAttackTime = Date.now() / 1000 + this.attackCooldown;
                }
            }
        }
    }

    resolveCollisions(planets, ships) {
        for (const planet of planets) {
            const dist = Vector2.distance(this.position, planet.position);
            const minDist = planet.size + PLANET_CLEARANCE;

            if (dist < minDist) {
                const angle = Math.atan2(
                    this.position.y - planet.position.y,
                    this.position.x - planet.position.x
                );
                this.position.x = planet.position.x + Math.cos(angle) * minDist;
                this.position.y = planet.position.y + Math.sin(angle) * minDist;
            }
        }

        for (const ship of ships) {
            if (ship.id === this.id || ship.health <= 0) continue;

            const dist = Vector2.distance(this.position, ship.position);
            const minDist = SHIP_SPACING;

            if (dist < minDist && dist > 0.1) {
                const overlap = minDist - dist;
                const angle = Math.atan2(
                    this.position.y - ship.position.y,
                    this.position.x - ship.position.x
                );

                const pushX = Math.cos(angle) * (overlap / 2);
                const pushY = Math.sin(angle) * (overlap / 2);

                this.position.x += pushX;
                this.position.y += pushY;
            }
        }
    }

    findNearestEnemyShip(ships) {
        let nearest = null;
        let minDist = ATTACK_RANGE;

        for (const ship of ships) {
            if (ship.team !== this.team && ship.health > 0) {
                const dist = Vector2.distance(this.position, ship.position);
                if (dist < minDist) {
                    minDist = dist;
                    nearest = ship;
                }
            }
        }

        return nearest;
    }

    engageCombat(enemy, game) {
        this.attackTarget = enemy;
        this.attackAnimationTime = 0.2;
        enemy.attackTarget = this;
        enemy.attackAnimationTime = 0.2;

        this.dealDamage(enemy, game);
        if (enemy.health > 0) {
            enemy.dealDamage(this, game);
        }
    }

    dealDamage(target, game) {
        const baseDamage = this.attack * 0.5;
        const damageReduction = target.defense / (target.defense + 50);
        const finalDamage = baseDamage * (1 - damageReduction * 0.5);

        target.health -= finalDamage;

        if (game && target.health <= 0) {
            game.awardPoints(this.team, game.POINTS_PER_SHIP);
        }
    }

    attackPlanet(planet, game) {
        this.attackTarget = planet;
        this.attackAnimationTime = 0.2;

        const damage = this.attack * 0.5;
        planet.takeDamage(damage, this.team, game);
    }

    draw(ctx) {
        const color = TEAM_COLORS[this.team];

        if (this.attackTarget && this.attackAnimationTime > 0) {
            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.globalAlpha = this.attackAnimationTime / 0.2;
            ctx.beginPath();
            ctx.moveTo(this.position.x, this.position.y);
            ctx.lineTo(this.attackTarget.position.x, this.attackTarget.position.y);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.restore();
        }

        ctx.save();
        ctx.translate(this.position.x, this.position.y);
        ctx.rotate(this.rotation);

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(6, 0);
        ctx.lineTo(-4, -4);
        ctx.lineTo(-4, 4);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.restore();
    }
}

class AIController {
    constructor(teamName, game) {
        this.teamName = teamName;
        this.game = game;

        // Tunable AI parameters
        this.params = {
            commandCooldown: 1.5,           // Even faster decisions for more action
            minShipsToAttack: 5,            // Lower barrier to attack
            defenseRadius: 200,
            defenseThreshold: 15,           // Higher threshold to reduce defensive triggers
            enemyAttackChance: 0.7,         // More aggressive vs enemies
            defensePersistence: 3,          // Allow more defense before forcing offense
            minShipsForDefense: 8,          // Need more ships to defend (prevents weak defense)
            enableLogging: DEBUG
        };

        this.consecutiveDefense = 0;
        this.hasLoggedDefenseBreak = false;

        this.state = {
            lastCommandTime: -10,
            currentTarget: null
        };

        this.logBuffer = [];
    }

    log(message, data = {}) {
        if (!this.params.enableLogging) return;

        const timestamp = new Date().toISOString();
        const gameTime = (Date.now() / 1000).toFixed(2);
        const teamColor = TEAM_COLORS[this.teamName] || '#ffffff';
        const logEntry = {
            timestamp,
            gameTime,
            team: this.teamName,
            color: teamColor,
            message,
            data
        };

        this.logBuffer.push(logEntry);
        console.log(`[AI ${this.teamName} ${teamColor}] ${message}`, data);
    }

    update(dt) {
        // Stop logging if game is over
        if (this.game.gameOver) {
            return;
        }

        const currentTime = Date.now() / 1000;
        const teamPlanets = this.game.planets.filter(p => p.team === this.teamName);
        const teamShipsAlive = this.game.ships.filter(s => s.team === this.teamName && s.health > 0);

        // Stop logging if team is eliminated
        if (teamPlanets.length === 0 && teamShipsAlive.length === 0) {
            return;
        }

        if (teamPlanets.length === 0) {
            // No planets left — redirect surviving ships to a target
            const teamShips = this.game.ships.filter(s => s.team === this.teamName && s.health > 0);
            if (teamShips.length === 0) return;

             // If we already have a homeless target, stick with it until captured or gone
            if (this.state.currentTarget && this.state.currentTarget.team !== this.teamName) {
                for (const ship of teamShips) {
                    ship.target = this.state.currentTarget;
                    ship.isDefending = false;
                }
                return;
            }

            const currentTime = Date.now() / 1000;
            if (currentTime - this.state.lastCommandTime < this.params.commandCooldown) return;

            // First: look for closest neutral planet
            const neutralPlanets = this.game.planets.filter(p => p.team === 'neutral');
            let target = null;

            if (neutralPlanets.length > 0) {
                // Find closest neutral to the fleet centroid
                const cx = teamShips.reduce((s, sh) => s + sh.position.x, 0) / teamShips.length;
                const cy = teamShips.reduce((s, sh) => s + sh.position.y, 0) / teamShips.length;
                neutralPlanets.sort((a, b) =>
                    Vector2.distance(a.position, {x: cx, y: cy}) -
                    Vector2.distance(b.position, {x: cx, y: cy})
                );
                // Pick from the 3 closest neutrals randomly
                const topNeutrals = neutralPlanets.slice(0, Math.min(3, neutralPlanets.length));
                target = topNeutrals[Math.floor(Math.random() * topNeutrals.length)];
            } else {
                // No neutrals — find the enemy planet with the fewest ships nearby
                const enemyPlanets = this.game.planets.filter(p => p.team !== this.teamName && p.team !== 'neutral');
                if (enemyPlanets.length > 0) {
                    enemyPlanets.sort((a, b) => {
                        const shipsA = this.game.ships.filter(s => s.health > 0 && Vector2.distance(s.position, a.position) < 150).length;
                        const shipsB = this.game.ships.filter(s => s.health > 0 && Vector2.distance(s.position, b.position) < 150).length;
                        return shipsA - shipsB;
                    });
                    target = enemyPlanets[0];
                }
            }

            if (target) {
                this.state.currentTarget = target;
                for (const ship of teamShips) {
                    ship.target = target;
                    ship.isDefending = false;
                }
                this.state.lastCommandTime = currentTime;
            }
            return;
        }

        const timeSinceLastCommand = currentTime - this.state.lastCommandTime;

        if (timeSinceLastCommand < this.params.commandCooldown) {
            return;
        }

        const teamShips = this.game.ships.filter(s => s.team === this.teamName && s.health > 0);

        if (teamShips.length < this.params.minShipsToAttack) {
            return;
        }

        // Check for planets under attack
        let planetUnderAttack = null;
        let maxEnemies = 0;
        for (const planet of teamPlanets) {
            const nearbyEnemies = this.game.ships.filter(s =>
                s.team !== this.teamName &&
                s.health > 0 &&
                Vector2.distance(s.position, planet.position) < planet.size + ATTACK_RANGE
            );

            if (nearbyEnemies.length > maxEnemies) {
                maxEnemies = nearbyEnemies.length;
                planetUnderAttack = planet;
            }
        }

        // Defensive behavior - but prevent defensive trap
        if (planetUnderAttack && maxEnemies >= this.params.defenseThreshold &&
            this.consecutiveDefense < this.params.defensePersistence &&
            teamShips.length >= this.params.minShipsForDefense) {
            this.log(`[${this.teamName.toUpperCase()}] DEFENSIVE ACTION: Protecting planet`, {
                planetId: planetUnderAttack.id,
                enemyCount: maxEnemies,
                threshold: this.params.defenseThreshold,
                consecutiveDefense: this.consecutiveDefense + 1
            });
            this.game.assignTeamShipsToTarget(this.teamName, planetUnderAttack);
            this.state.lastCommandTime = currentTime;
            this.state.currentTarget = planetUnderAttack;
            this.consecutiveDefense++;
            this.hasLoggedDefenseBreak = false;
            return;
        }

        // Force offensive action if stuck defending (log only once)
        if (this.consecutiveDefense >= this.params.defensePersistence && !this.hasLoggedDefenseBreak) {
            this.log(`[${this.teamName.toUpperCase()}] BREAKING DEFENSIVE LOOP - Forcing offense`, {
                consecutiveDefense: this.consecutiveDefense
            });
            this.hasLoggedDefenseBreak = true;
        }

        // Randomly abandon current target to break loops
        const shouldPickNewTarget = Math.random() < 0.15; // 15% chance each cooldown cycle
        const currentTargetConquered = !this.state.currentTarget ||
            this.state.currentTarget.team === this.teamName ||
            shouldPickNewTarget;

        // Always re-issue orders to pull in newly produced ships, even if target hasn't changed
        if (!currentTargetConquered) {
            this.game.assignTeamShipsToTarget(this.teamName, this.state.currentTarget);
            this.state.lastCommandTime = currentTime;
        }

        if (currentTargetConquered) {
            const reachablePlanets = this.game.getReachablePlanets(this.teamName);
            const neutralTargets = reachablePlanets.filter(p => p.team === 'neutral');
            const enemyTargets = reachablePlanets.filter(p => p.team !== this.teamName && p.team !== 'neutral');

            let target = null;

            // Smarter target selection: prioritize weak enemies when strong
            if (enemyTargets.length > 0 && (Math.random() < this.params.enemyAttackChance || teamShips.length > 50)) {
                // Sort by closest first for efficiency
                const teamCenter = teamPlanets.reduce((acc, p) => {
                    acc.x += p.position.x;
                    acc.y += p.position.y;
                    return acc;
                }, {x: 0, y: 0});
                teamCenter.x /= teamPlanets.length;
                teamCenter.y /= teamPlanets.length;

                enemyTargets.sort((a, b) => {
                    const distA = Vector2.distance(a.position, teamCenter);
                    const distB = Vector2.distance(b.position, teamCenter);
                    return distA - distB;
                });

                target = enemyTargets[0];
                this.log(`[${this.teamName.toUpperCase()}] OFFENSIVE ACTION: Attacking ${target.team} planet`, {
                    planetId: target.id,
                    planetTeam: target.team,
                    ships: teamShips.length
                });
            } else if (neutralTargets.length > 0) {
                target = neutralTargets[Math.floor(Math.random() * neutralTargets.length)];
                this.log(`[${this.teamName.toUpperCase()}] OFFENSIVE ACTION: Attacking neutral planet`, {
                    planetId: target.id,
                    ships: teamShips.length
                });
            } else if (enemyTargets.length > 0) {
                // Fallback: attack any enemy if no neutrals left
                target = enemyTargets[Math.floor(Math.random() * enemyTargets.length)];
                this.log(`[${this.teamName.toUpperCase()}] OFFENSIVE ACTION: Attacking ${target.team} planet`, {
                    planetId: target.id,
                    planetTeam: target.team,
                    ships: teamShips.length
                });
            }

            if (target) {
                this.game.assignTeamShipsToTarget(this.teamName, target);
                this.state.lastCommandTime = currentTime;
                this.state.currentTarget = target;
                this.consecutiveDefense = 0;  // Reset defensive counter on offense
                this.hasLoggedDefenseBreak = false;
            }
        }
    }
}

class Game {
    constructor(settings = {}) {
        this.settings = {
            galaxySize: settings.galaxySize || 'medium',
            playerCount: settings.playerCount || 2,
            aiOnlyMode: settings.aiOnlyMode || false,
            batchTestMode: settings.batchTestMode || false,
            speedMultiplier: settings.speedMultiplier || 1
        };

        this.planets = [];
        this.ships = [];
        this.teams = {
            neutral: { attackTokens: 2, defenseTokens: 2, speedTokens: 2, points: 0, tokens: 0, tokensEarned: 0 },
            team1: { attackTokens: 0, defenseTokens: 0, speedTokens: 0, points: 0, tokens: 6, tokensEarned: 0 },
            team2: { attackTokens: 0, defenseTokens: 0, speedTokens: 0, points: 0, tokens: 6, tokensEarned: 0 },
            team3: { attackTokens: 0, defenseTokens: 0, speedTokens: 0, points: 0, tokens: 6, tokensEarned: 0 },
            team4: { attackTokens: 0, defenseTokens: 0, speedTokens: 0, points: 0, tokens: 6, tokensEarned: 0 },
            team5: { attackTokens: 0, defenseTokens: 0, speedTokens: 0, points: 0, tokens: 6, tokensEarned: 0 }
        };

        this.BASE_TOKEN_COST = 50;
        this.TOKEN_COST_INCREASE = 25;
        this.POINTS_PER_PLANET = 50;
        this.POINTS_PER_SHIP = 5;

        this.applyInitialTokens();

        this.targetPlanets = [];
        this.nextShipId = 0;
        this.paused = false;
        this.gameOver = false;
        this.stopped = false;
        this.frameCounter = 0;
        this.winner = null;
        const activeTeams = ['team2', 'team3', 'team4', 'team5'].slice(0, this.settings.playerCount - 1);
        if (this.settings.aiOnlyMode) {
            activeTeams.unshift('team1');
        }

        this.aiControllers = {};
        for (const team of activeTeams) {
            this.aiControllers[team] = new AIController(team, this);
        }

        this.gameStartTime = Date.now();

        this.camera = {
            x: 0,
            y: 0,
            zoom: 1,
            isDragging: false,
            lastMouseX: 0,
            lastMouseY: 0,
            hasDragged: false
        };

        this.initializePlanets();
        this.setupEventListeners();
        this.updateUpgradeUI();

        this.lastTime = Date.now();
        this.gameLoop();
    }

    getTeamAttack(team) {
        return BASE_ATTACK + (this.teams[team].attackTokens * ATTACK_PER_TOKEN);
    }

    getTeamDefense(team) {
        return BASE_DEFENSE + (this.teams[team].defenseTokens * DEFENSE_PER_TOKEN);
    }

    getTeamSpeed(team) {
        return BASE_SPEED + (this.teams[team].speedTokens * SPEED_PER_TOKEN);
    }

    getTokenCost(team) {
        const tokensEarned = this.teams[team].tokensEarned;
        return this.BASE_TOKEN_COST + (tokensEarned * this.TOKEN_COST_INCREASE);
    }

    applyInitialTokens() {
        this.upgradeStat('team1', 'attack', 2);
        this.upgradeStat('team1', 'defense', 2);
        this.upgradeStat('team1', 'speed', 2);

        this.upgradeStat('team2', 'attack', 4);
        this.upgradeStat('team2', 'defense', 1);
        this.upgradeStat('team2', 'speed', 1);

        this.upgradeStat('team3', 'attack', 1);
        this.upgradeStat('team3', 'defense', 4);
        this.upgradeStat('team3', 'speed', 1);

        this.upgradeStat('team4', 'attack', 2);
        this.upgradeStat('team4', 'defense', 2);
        this.upgradeStat('team4', 'speed', 2);

        this.upgradeStat('team5', 'attack', 1);
        this.upgradeStat('team5', 'defense', 1);
        this.upgradeStat('team5', 'speed', 4);
    }

    upgradeStat(team, stat, amount = 1) {
        const teamData = this.teams[team];
        if (!teamData || teamData.tokens < amount) return false;

        if (stat === 'attack') {
            teamData.attackTokens += amount;
        } else if (stat === 'defense') {
            teamData.defenseTokens += amount;
        } else if (stat === 'speed') {
            teamData.speedTokens += amount;
        }

        teamData.tokens -= amount;
        return true;
    }

    awardPoints(team, points) {
        const teamData = this.teams[team];
        if (!teamData) return;

        teamData.points += points;

        while (teamData.points >= this.getTokenCost(team)) {
            teamData.points -= this.getTokenCost(team);
            teamData.tokens++;
            teamData.tokensEarned++;

            if (team !== 'team1' && team !== 'neutral') {
                this.aiSpendTokens(team, 1);
            }
        }
    }

    aiSpendTokens(team, tokensToSpend) {
        console.log(`[AI] ${team} spending ${tokensToSpend} token(s) on upgrades`);
        const strategies = {
            team2: ['attack', 'attack', 'attack', 'speed'],
            team3: ['defense', 'defense', 'defense', 'attack'],
            team4: ['attack', 'defense', 'speed', 'attack'],
            team5: ['speed', 'speed', 'speed', 'attack']
        };

        const strategy = strategies[team] || ['attack', 'defense', 'speed', 'attack'];

        for (let i = 0; i < tokensToSpend; i++) {
            const stat = strategy[i % strategy.length];
            this.upgradeStat(team, stat, 1);
        }
    }

    initializePlanets() {
        const galaxySizes = {
            small: 20,
            medium: 30,
            large: 40,
            huge: 50
        };
        const totalPlanets = galaxySizes[this.settings.galaxySize] || 30;

        const sizeMultipliers = {
            small: 1.0,
            medium: 1.5,
            large: 2.0,
            huge: 2.5
        };
        const sizeMultiplier = sizeMultipliers[this.settings.galaxySize] || 1.5;

        const w = canvas.width * sizeMultiplier;
        const h = canvas.height * sizeMultiplier;
        const margin = 150;
        const minDistance = 120;

        const positions = [];

        const tryPlacePlanet = () => {
            for (let attempts = 0; attempts < 200; attempts++) {
                const x = margin + Math.random() * (w - margin * 2);
                const y = margin + Math.random() * (h - margin * 2);

                let valid = true;
                for (const pos of positions) {
                    const dist = Vector2.distance({ x, y }, pos);
                    if (dist < minDistance) {
                        valid = false;
                        break;
                    }
                }

                if (valid) {
                    positions.push({ x, y });
                    return { x, y };
                }
            }
            return null;
        };

        const pos0 = { x: margin + 100, y: h / 2 };
        const pos1 = { x: w - margin - 100, y: h / 2 };
        positions.push(pos0, pos1);

        const teamPlanets = Math.min(this.settings.playerCount, 5);
        const teams = ['team1', 'team2', 'team3', 'team4', 'team5'];

        const initialZoom = {
            small: 1.0,
            medium: 0.7,
            large: 0.5,
            huge: 0.4
        };
        const zoom = initialZoom[this.settings.galaxySize] || 0.7;

        this.camera.zoom = zoom;
        this.camera.x = (w / 2) - (canvas.width / 2) / zoom;
        this.camera.y = (h / 2) - (canvas.height / 2) / zoom;

        for (let i = 0; i < teamPlanets; i++) {
            const pos = i === 0 ? pos0 : (i === 1 ? pos1 : tryPlacePlanet());
            if (pos) {
                this.planets.push(new Planet(i, pos.x, pos.y, teams[i], 200, 1, CAP_AMNT, this));
            }
        }

        for (let i = teamPlanets; i < totalPlanets; i++) {
            const pos = tryPlacePlanet();
            if (pos) {
                const health = i < teamPlanets + 2 ? 150 : 100;
                this.planets.push(new Planet(i, pos.x, pos.y, 'neutral', health, 1, CAP_AMNT, this));
            }
        }

        this.generateConnections();

        for (let i = 0; i < teamPlanets; i++) {
            const planet = this.planets[i];
            if (planet) {
                for (let j = 0; j < STARTING_SHIPS; j++) {
                    this.spawnShipAtPlanet(planet);
                }
            }
        }

        for (const planet of this.planets) {
            if (planet.team === 'neutral') {
                for (let i = 0; i < STARTING_SHIPS; i++) {
                    this.spawnShipAtPlanet(planet);
                }
            }
        }
    }

    isGraphConnected() {
        const planetCount = this.planets.length;
        if (planetCount === 0) return true;

        const visited = new Set();
        const queue = [0];
        visited.add(0);

        while (queue.length > 0) {
            const current = queue.shift();
            const planet = this.planets[current];

            for (const conn of planet.connections) {
                if (!visited.has(conn.targetId)) {
                    visited.add(conn.targetId);
                    queue.push(conn.targetId);
                }
            }

            for (let i = 0; i < planetCount; i++) {
                if (i !== current && !visited.has(i)) {
                    const otherPlanet = this.planets[i];
                    for (const conn of otherPlanet.connections) {
                        if (conn.targetId === current) {
                            visited.add(i);
                            queue.push(i);
                            break;
                        }
                    }
                }
            }
        }

        return visited.size === planetCount;
    }

    findConnectedComponents() {
        const planetCount = this.planets.length;
        const visited = new Set();
        const components = [];

        for (let startId = 0; startId < planetCount; startId++) {
            if (visited.has(startId)) continue;

            const component = [];
            const queue = [startId];
            visited.add(startId);

            while (queue.length > 0) {
                const current = queue.shift();
                component.push(current);
                const planet = this.planets[current];

                for (const conn of planet.connections) {
                    if (!visited.has(conn.targetId)) {
                        visited.add(conn.targetId);
                        queue.push(conn.targetId);
                    }
                }

                for (let i = 0; i < planetCount; i++) {
                    if (i !== current && !visited.has(i)) {
                        const otherPlanet = this.planets[i];
                        for (const conn of otherPlanet.connections) {
                            if (conn.targetId === current) {
                                visited.add(i);
                                queue.push(i);
                                break;
                            }
                        }
                    }
                }
            }

            components.push(component);
        }

        return components;
    }

    connectSeparateGroups() {
        const components = this.findConnectedComponents();

        if (components.length <= 1) return;

        for (let i = 0; i < components.length - 1; i++) {
            const group1 = components[i];
            const group2 = components[i + 1];

            let minDist = Infinity;
            let closestPair = null;

            for (const planetId1 of group1) {
                for (const planetId2 of group2) {
                    const dist = Vector2.distance(
                        this.planets[planetId1].position,
                        this.planets[planetId2].position
                    );
                    if (dist < minDist) {
                        minDist = dist;
                        closestPair = [planetId1, planetId2];
                    }
                }
            }

            if (closestPair) {
                this.planets[closestPair[0]].addConnection(closestPair[1], true);
                this.planets[closestPair[1]].addConnection(closestPair[0], true);
            }
        }
    }

    generateConnections() {
        const maxAttempts = 10;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            for (const planet of this.planets) {
                planet.connections = [];
            }

            const planetCount = this.planets.length;

            for (let i = 0; i < planetCount; i++) {
                const planet = this.planets[i];

                const currentUniqueConnections = this.getUniqueConnectionCount(i);
                const connectionsNeeded = Math.max(0, (2 + Math.floor(Math.random() * 3)) - currentUniqueConnections);

                if (connectionsNeeded > 0) {
                    const distances = this.getAvailableConnections(i, MAX_CONNECTION_DISTANCE);

                    let candidatesToUse = distances;
                    if (distances.length < connectionsNeeded) {
                        candidatesToUse = this.getAvailableConnections(i, Infinity);
                    }

                    for (let k = 0; k < Math.min(connectionsNeeded, candidatesToUse.length); k++) {
                        const targetId = candidatesToUse[k].id;
                        const isBidirectional = Math.random() < 0.7;

                        planet.addConnection(targetId, isBidirectional);

                        if (isBidirectional) {
                            this.planets[targetId].addConnection(i, true);
                        }
                    }
                }
            }

            this.ensureMinimumConnections();
            this.fixIsolatedPlanets();
            this.connectSeparateGroups();
            this.ensureBidirectionalConnectivity();

            if (this.validateBidirectionalReachability() && this.validateConnections()) {
                return;
            }
        }
    }

    getAvailableConnections(planetId, maxDistance) {
        const planet = this.planets[planetId];
        const distances = [];

        for (let j = 0; j < this.planets.length; j++) {
            if (planetId !== j) {
                const alreadyConnected = planet.connections.some(c => c.targetId === j) ||
                    this.planets[j].connections.some(c => c.targetId === planetId);
                if (!alreadyConnected) {
                    const dist = Vector2.distance(planet.position, this.planets[j].position);
                    if (dist <= maxDistance) {
                        distances.push({ id: j, dist });
                    }
                }
            }
        }

        distances.sort((a, b) => a.dist - b.dist);
        return distances;
    }

    getUniqueConnectionCount(planetId) {
        const planet = this.planets[planetId];
        const connectedPlanets = new Set();

        for (const conn of planet.connections) {
            connectedPlanets.add(conn.targetId);
        }

        for (let i = 0; i < this.planets.length; i++) {
            if (i !== planetId && this.planets[i].connections.some(c => c.targetId === planetId)) {
                connectedPlanets.add(i);
            }
        }

        return connectedPlanets.size;
    }

    ensureMinimumConnections() {
        const planetCount = this.planets.length;
        for (let i = 0; i < planetCount; i++) {
            const uniqueConnections = this.getUniqueConnectionCount(i);
            if (uniqueConnections < 2) {
                const planet = this.planets[i];
                let distances = this.getAvailableConnections(i, MAX_CONNECTION_DISTANCE);

                if (distances.length === 0) {
                    distances = this.getAvailableConnections(i, Infinity);
                }

                const needed = 2 - uniqueConnections;
                for (let k = 0; k < Math.min(needed, distances.length); k++) {
                    const targetId = distances[k].id;
                    planet.addConnection(targetId, true);
                    this.planets[targetId].addConnection(i, true);
                }
            }
        }
    }

    fixIsolatedPlanets() {
        const planetCount = this.planets.length;
        for (let i = 0; i < planetCount; i++) {
            const planet = this.planets[i];
            const hasOutgoing = planet.connections.length > 0;
            const hasIncoming = this.planets.some(p => p.connections.some(c => c.targetId === i));

            if (!hasOutgoing || !hasIncoming) {
                for (const conn of planet.connections) {
                    if (!conn.bidirectional) {
                        conn.bidirectional = true;
                        const targetPlanet = this.planets[conn.targetId];
                        const reverseConn = targetPlanet.connections.find(c => c.targetId === i);
                        if (!reverseConn) {
                            targetPlanet.addConnection(i, true);
                        } else {
                            reverseConn.bidirectional = true;
                        }
                    }
                }
            }
        }
    }

    validateConnections() {
        for (let i = 0; i < this.planets.length; i++) {
            const uniqueConnections = this.getUniqueConnectionCount(i);
            if (uniqueConnections < 2 || uniqueConnections > 4) {
                return false;
            }
            const planet = this.planets[i];
            const hasOutgoing = planet.connections.length > 0;
            const hasIncoming = this.planets.some(p => p.connections.some(c => c.targetId === i));
            if (!hasOutgoing || !hasIncoming) {
                return false;
            }
        }
        return true;
    }

    validateBidirectionalReachability() {
        const planetCount = this.planets.length;

        for (let start = 0; start < planetCount; start++) {
            const reachable = this.getReachableFrom(start);

            if (reachable.size !== planetCount) {
                return false;
            }
        }

        return true;
    }

    getReachableFrom(startId) {
        const visited = new Set();
        const queue = [startId];
        visited.add(startId);

        while (queue.length > 0) {
            const current = queue.shift();
            const planet = this.planets[current];

            for (const conn of planet.connections) {
                if (!visited.has(conn.targetId)) {
                    visited.add(conn.targetId);
                    queue.push(conn.targetId);
                }
            }
        }

        return visited;
    }

    ensureBidirectionalConnectivity() {
        const planetCount = this.planets.length;

        for (let start = 0; start < planetCount; start++) {
            const reachable = this.getReachableFrom(start);

            if (reachable.size < planetCount) {
                const unreachable = [];
                for (let i = 0; i < planetCount; i++) {
                    if (!reachable.has(i)) {
                        unreachable.push(i);
                    }
                }

                if (unreachable.length > 0) {
                    let minDist = Infinity;
                    let closestPair = null;

                    for (const reachableId of reachable) {
                        for (const unreachableId of unreachable) {
                            const dist = Vector2.distance(
                                this.planets[reachableId].position,
                                this.planets[unreachableId].position
                            );
                            if (dist < minDist) {
                                minDist = dist;
                                closestPair = [reachableId, unreachableId];
                            }
                        }
                    }

                    if (closestPair) {
                        this.planets[closestPair[0]].addConnection(closestPair[1], true);
                        this.planets[closestPair[1]].addConnection(closestPair[0], true);
                    }
                }
            }
        }
    }

    setupEventListeners() {

        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const worldX = (mouseX - this.camera.x) / this.camera.zoom;
            const worldY = (mouseY - this.camera.y) / this.camera.zoom;

            const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
            const newZoom = Math.max(0.1, this.camera.zoom * zoomFactor);

            this.camera.zoom = newZoom;
            this.camera.x = mouseX - worldX * this.camera.zoom;
            this.camera.y = mouseY - worldY * this.camera.zoom;
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

                const totalDistance = Math.abs(dx) + Math.abs(dy);
                if (totalDistance > 3) {
                    this.camera.hasDragged = true;
                }
            }
        });

        canvas.addEventListener('mouseup', (e) => {
            if (e.button === 0) {
                if (!this.camera.hasDragged) {
                    this.handleClick(e);
                }
                this.camera.isDragging = false;
                this.camera.hasDragged = false;
            }
        });

        canvas.addEventListener('mouseleave', () => {
            this.camera.isDragging = false;
        });

        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space') {
                e.preventDefault();
                this.paused = !this.paused;
            }
        });

        document.getElementById('restartButton').addEventListener('click', () => {
            location.reload();
        });

        document.getElementById('upgradeAttack').addEventListener('click', () => {
            if (this.upgradeStat('team1', 'attack', 1)) {
                this.updateUpgradeUI();
            }
        });

        document.getElementById('upgradeDefense').addEventListener('click', () => {
            if (this.upgradeStat('team1', 'defense', 1)) {
                this.updateUpgradeUI();
            }
        });

        document.getElementById('upgradeSpeed').addEventListener('click', () => {
            if (this.upgradeStat('team1', 'speed', 1)) {
                this.updateUpgradeUI();
            }
        });
    }

    updateUpgradeUI() {
        const team1 = this.teams.team1;

        const tokenCost = this.getTokenCost('team1');
        const progressPercent = (team1.points / tokenCost) * 100;

        document.getElementById('progressBar').style.width = progressPercent + '%';
        document.getElementById('playerTokens').textContent = team1.tokens;
        document.getElementById('attackValue').textContent = team1.attackTokens;
        document.getElementById('defenseValue').textContent = team1.defenseTokens;
        document.getElementById('speedValue').textContent = team1.speedTokens;

        const hasTokens = team1.tokens > 0;
        const tokenDisplay = document.getElementById('tokenDisplay');

        if (hasTokens) {
            tokenDisplay.classList.remove('hidden');
        } else {
            tokenDisplay.classList.add('hidden');
        }

        document.getElementById('upgradeAttack').disabled = !hasTokens;
        document.getElementById('upgradeDefense').disabled = !hasTokens;
        document.getElementById('upgradeSpeed').disabled = !hasTokens;

        if (!hasTokens) {
            document.getElementById('upgradeAttack').classList.add('opacity-50', 'cursor-not-allowed');
            document.getElementById('upgradeDefense').classList.add('opacity-50', 'cursor-not-allowed');
            document.getElementById('upgradeSpeed').classList.add('opacity-50', 'cursor-not-allowed');
        } else {
            document.getElementById('upgradeAttack').classList.remove('opacity-50', 'cursor-not-allowed');
            document.getElementById('upgradeDefense').classList.remove('opacity-50', 'cursor-not-allowed');
            document.getElementById('upgradeSpeed').classList.remove('opacity-50', 'cursor-not-allowed');
        }
    }

    handleClick(e) {
        if (this.gameOver) return;

        const rect = canvas.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;

        const x = (screenX - this.camera.x) / this.camera.zoom;
        const y = (screenY - this.camera.y) / this.camera.zoom;

        let clickedPlanet = null;
        for (const planet of this.planets) {
            const dist = Vector2.distance({ x, y }, planet.position);
            if (dist <= planet.size) {
                clickedPlanet = planet;
                break;
            }
        }

        if (clickedPlanet) {
            const isOwnPlanet = clickedPlanet.team === 'team1';
            const isReachable = this.canTeamReachPlanet('team1', clickedPlanet.id);
            if (isOwnPlanet || !isReachable) {
                return;
            }
        }

        if (e.shiftKey && this.targetPlanets.length < 3) {
            if (clickedPlanet) {
                this.targetPlanets.push(clickedPlanet);
            } else {
                this.targetPlanets.push({ position: { x, y }, team: 'neutral' });
            }
        } else {
            if (clickedPlanet) {
                this.targetPlanets = [clickedPlanet];
            } else {
                this.targetPlanets = [{ position: { x, y }, team: 'neutral' }];
            }
        }

        this.assignShipsToTargets();
    }

    spawnShipAtPlanet(planet) {
        const angle = Math.random() * Math.PI * 2;
        const distance = planet.size + 15;
        const x = planet.position.x + Math.cos(angle) * distance;
        const y = planet.position.y + Math.sin(angle) * distance;

        const ship = new Ship(this.nextShipId++, planet.team, x, y, this, planet);
        ship.rotation = angle;
        this.ships.push(ship);
        return ship;
    }

    updateProduction(dt) {
        for (const planet of this.planets) {
            if (planet.team === 'neutral') {
                const planetShips = this.ships.filter(s =>
                    s.team === 'neutral' &&
                    s.health > 0 &&
                    s.homePlanet === planet
                ).length;

                if (planetShips < STARTING_SHIPS && planet.productionTimer >= PRODUCTION_INTERVAL) {
                    this.spawnShipAtPlanet(planet);
                    planet.productionTimer = 0;
                }
                continue;
            }

            const teamShips = this.ships.filter(s => s.team === planet.team && s.health > 0).length;
            const maxFleet = this.getMaxFleet(planet.team);

            if (teamShips < maxFleet && planet.productionTimer >= PRODUCTION_INTERVAL) {
                this.spawnShipAtPlanet(planet);
                planet.productionTimer = 0;
            }
        }
    }

    canTeamReachPlanet(team, targetPlanetId) {
        const teamPlanets = this.planets.filter(p => p.team === team);
        if (teamPlanets.length === 0) return false;

        for (const planet of teamPlanets) {
            for (const conn of planet.connections) {
                if (conn.targetId === targetPlanetId) {
                    return true;
                }
            }
        }

        return false;
    }

    getReachablePlanets(team) {
        const teamPlanets = this.planets.filter(p => p.team === team);
        const reachable = [];
        const reachableIds = new Set();

        for (const planet of teamPlanets) {
            for (const conn of planet.connections) {
                if (!reachableIds.has(conn.targetId)) {
                    reachableIds.add(conn.targetId);
                    reachable.push(this.planets[conn.targetId]);
                }
            }
        }

        return reachable;
    }

    assignShipsToTargets() {
        if (this.targetPlanets.length === 0) return;

        const playerShips = this.ships.filter(s => s.team === 'team1');

        if (this.targetPlanets.length === 1) {
            for (const ship of playerShips) {
                ship.target = this.targetPlanets[0];
                ship.isDefending = false;
            }
        } else {
            const assignments = this.targetPlanets.map(() => []);

            for (const ship of playerShips) {
                let minIndex = 0;
                let minCount = assignments[0].length;

                for (let i = 1; i < assignments.length; i++) {
                    if (assignments[i].length < minCount) {
                        minCount = assignments[i].length;
                        minIndex = i;
                    }
                }

                assignments[minIndex].push(ship);
                ship.target = this.targetPlanets[minIndex];
                ship.isDefending = false;
            }
        }
    }

    getMaxFleet(team) {
        if (team === 'neutral') {
            return this.planets.filter(p => p.team === 'neutral').length * STARTING_SHIPS;
        }
        const ownedPlanets = this.planets.filter(p => p.team === team).length;
        return BASE_CAP + (ownedPlanets * CAP_AMNT);
    }

    updateProduction(dt) {
        for (const planet of this.planets) {
            if (planet.team === 'neutral') {
                const planetShips = this.ships.filter(s =>
                    s.team === 'neutral' &&
                    s.health > 0 &&
                    s.homePlanet === planet
                ).length;

                if (planetShips < STARTING_SHIPS && planet.productionTimer >= PRODUCTION_INTERVAL) {
                    this.spawnShipAtPlanet(planet);
                    planet.productionTimer = 0;
                }
                continue;
            }

            const teamShips = this.ships.filter(s => s.team === planet.team && s.health > 0).length;
            const maxFleet = this.getMaxFleet(planet.team);

            if (teamShips < maxFleet && planet.productionTimer >= PRODUCTION_INTERVAL) {
                this.spawnShipAtPlanet(planet);
                planet.productionTimer = 0;
            }
        }
    }

    canTeamReachPlanet(team, targetPlanetId) {
        const teamPlanets = this.planets.filter(p => p.team === team);
        if (teamPlanets.length === 0) return false;

        for (const planet of teamPlanets) {
            for (const conn of planet.connections) {
                if (conn.targetId === targetPlanetId) {
                    return true;
                }
            }
        }

        return false;
    }

    getReachablePlanets(team) {
        const teamPlanets = this.planets.filter(p => p.team === team);
        const reachable = [];
        const reachableIds = new Set();

        for (const planet of teamPlanets) {
            for (const conn of planet.connections) {
                if (!reachableIds.has(conn.targetId)) {
                    reachableIds.add(conn.targetId);
                    reachable.push(this.planets[conn.targetId]);
                }
            }
        }

        return reachable;
    }

    assignTeamShipsToTarget(team, target) {
        const teamShips = this.ships.filter(s => s.team === team && s.health > 0);

        for (const ship of teamShips) {
            ship.target = target;
            ship.isDefending = false;
        }
    }

    getPlayerReachablePlanetIds() {
        const playerPlanets = this.planets.filter(p => p.team === 'team1');
        if (playerPlanets.length === 0) {
            return new Set(this.planets.map(p => p.id));
        }

        const reachableIds = new Set();
        for (const planet of playerPlanets) {
            reachableIds.add(planet.id);
            for (const conn of planet.connections) {
                reachableIds.add(conn.targetId);
            }
        }

        return reachableIds;
    }

    exportAILogs() {
        let logText = `=== AI Behavior Logs ===\n`;
        logText += `Game Start: ${new Date(this.gameStartTime).toISOString()}\n`;
        logText += `Game Duration: ${((Date.now() - this.gameStartTime) / 1000).toFixed(2)}s\n`;
        logText += `Galaxy Size: ${this.settings.galaxySize}\n`;
        logText += `Player Count: ${this.settings.playerCount}\n`;
        logText += `AI-Only Mode: ${this.settings.aiOnlyMode}\n`;
        logText += `\n${'='.repeat(80)}\n\n`;

        for (const teamName in this.aiControllers) {
            const controller = this.aiControllers[teamName];
            const teamColor = TEAM_COLORS[teamName] || '#ffffff';
            logText += `\n### ${teamName.toUpperCase()} (${teamColor}) LOGS ###\n`;
            logText += `Parameters: ${JSON.stringify(controller.params, null, 2)}\n`;
            logText += `Total Log Entries: ${controller.logBuffer.length}\n\n`;

            for (const entry of controller.logBuffer) {
                logText += `[${entry.gameTime}s] ${entry.message}\n`;
                if (Object.keys(entry.data).length > 0) {
                    logText += `  Data: ${JSON.stringify(entry.data)}\n`;
                }
            }

            logText += `\n${'='.repeat(80)}\n`;
        }

        return logText;
    }

    downloadAILogs() {
        const logText = this.exportAILogs();
        const blob = new Blob([logText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ai_logs_${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    updateAI(dt) {
        for (const teamName in this.aiControllers) {
            const controller = this.aiControllers[teamName];
            controller.update(dt);
        }
    }

    checkWinConditions() {
        if (this.settings.aiOnlyMode && !this.settings.batchTestMode) {
            return;
        }

        // In batch test mode, check for winner in AI-only games
        if (this.settings.aiOnlyMode && this.settings.batchTestMode) {
            const planetTeams = new Set();
            for (const planet of this.planets) {
                planetTeams.add(planet.team);
            }

            if (planetTeams.size === 1 && !planetTeams.has('neutral')) {
                const winningTeam = Array.from(planetTeams)[0];
                const enemyShipsAlive = this.ships.some(s => s.health > 0 && s.team !== winningTeam && s.team !== 'neutral');
                if (!enemyShipsAlive) {
                    this.gameOver = true;
                    this.winner = winningTeam;
                    this.handleBatchTestCompletion();
                    return;
                }
            }
        }

        const planetTeams = new Set();
        const hasNeutralPlanets = this.planets.some(p => p.team === 'neutral');

        for (const planet of this.planets) {
            planetTeams.add(planet.team);
        }

        const activTeams = new Set();
        for (const ship of this.ships) {
            if (ship.health > 0 && ship.team !== 'neutral') {
                activTeams.add(ship.team);
            }
        }

        if (planetTeams.size === 1 && !hasNeutralPlanets) {
            const winningTeam = Array.from(planetTeams)[0];
            if (winningTeam !== 'neutral') {
                this.gameOver = true;
                this.winner = winningTeam;
                this.showGameOver();
            }
        } else if (activTeams.size === 0 && planetTeams.size === 1 && planetTeams.has('neutral')) {
            this.gameOver = true;
            this.winner = 'neutral';
            this.showGameOver();
        }
    }

    showGameOver() {
        const screen = document.getElementById('gameOverScreen');
        const title = document.getElementById('gameOverTitle');
        const message = document.getElementById('gameOverMessage');

        if (this.winner === 'team1') {
            title.textContent = '🎉 Victory!';
            title.style.color = TEAM_COLORS.team1;
            message.textContent = 'You have conquered the galaxy!';
        } else {
            title.textContent = '💀 Defeat';
            title.style.color = TEAM_COLORS[this.winner];
            message.textContent = `${TEAM_NAMES[this.winner]} has conquered the galaxy.`;
        }

        screen.classList.remove('hidden');
    }

    handleBatchTestCompletion() {
        // Record test results
        if (!window.batchTestResults) {
            window.batchTestResults = [];
        }

        const gameDuration = (Date.now() - this.gameStartTime) / 1000;

        // Collect AI logs from this game
        const aiLogs = {};
        for (const teamName in this.aiControllers) {
            const controller = this.aiControllers[teamName];
            aiLogs[teamName] = {
                totalActions: controller.logBuffer.length,
                logs: controller.logBuffer
            };
        }

        window.batchTestResults.push({
            gameNumber: window.currentTestGame,
            winner: this.winner,
            duration: gameDuration,
            finalPlanets: this.planets.filter(p => p.team === this.winner).length,
            aiLogs: aiLogs
        });

        console.log(`[BATCH TEST ${window.currentTestGame}/${window.totalTestGames}] Winner: ${this.winner}, Duration: ${gameDuration.toFixed(1)}s`);

        // Check if more tests to run
        if (window.currentTestGame < window.totalTestGames) {
            window.currentTestGame++;
            // Restart game after short delay
            setTimeout(() => {
                game.stopped = true;
                startGame();
            }, 100);
        } else {
            // All tests complete - show results
            this.showBatchTestResults();
        }
    }

    showBatchTestResults() {
        console.log('\n=== BATCH TEST RESULTS ===');
        console.log(`Total Games: ${window.totalTestGames}`);

        const winCounts = {};
        let totalDuration = 0;

        for (const result of window.batchTestResults) {
            winCounts[result.winner] = (winCounts[result.winner] || 0) + 1;
            totalDuration += result.duration;
        }

        console.log('\nWin Distribution:');
        for (const team in winCounts) {
            const percentage = ((winCounts[team] / window.totalTestGames) * 100).toFixed(1);
            console.log(`  ${TEAM_NAMES[team]}: ${winCounts[team]} wins (${percentage}%)`);
        }

        console.log(`\nAverage Game Duration: ${(totalDuration / window.totalTestGames).toFixed(1)}s`);
        console.log('========================\n');

        // Download results as JSON with AI logs
        const resultsJson = JSON.stringify({
            totalGames: window.totalTestGames,
            winCounts,
            averageDuration: totalDuration / window.totalTestGames,
            games: window.batchTestResults,
            summary: {
                totalGames: window.totalTestGames,
                winDistribution: winCounts,
                averageDuration: totalDuration / window.totalTestGames
            }
        }, null, 2);

        const blob = new Blob([resultsJson], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `batch_test_results_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        alert(`Batch testing complete!\n\nResults saved to JSON file.\nCheck console for summary.`);

        // Reset for next batch
        window.batchTestResults = [];
        window.currentTestGame = 0;
        window.totalTestGames = 0;
    }

    update(dt) {
        if (this.paused || this.gameOver) return;

        for (const planet of this.planets) {
            const defenseLevel = planet.team !== 'neutral' ? this.getTeamDefense(planet.team) / 10 : 1;
            planet.update(dt, defenseLevel);
        }

        for (const ship of this.ships) {
            if (ship.health > 0) {
                const defenseLevel = this.getTeamDefense(ship.team) / 10;
                ship.update(dt, this.planets, this.ships, defenseLevel, this);
            }
        }

        this.ships = this.ships.filter(s => s.health > 0);

        this.updateProduction(dt);
        this.updateAI(dt);
        this.checkWinConditions();
    }

    drawConnections() {
        const drawnPairs = new Set();

        for (const planet of this.planets) {
            for (const conn of planet.connections) {
                const target = this.planets[conn.targetId];
                if (!target) continue;

                const pairKey = conn.bidirectional ?
                    [Math.min(planet.id, target.id), Math.max(planet.id, target.id)].join('-') :
                    null;

                if (conn.bidirectional && pairKey && drawnPairs.has(pairKey)) {
                    continue;
                }

                if (pairKey) drawnPairs.add(pairKey);

                const fromX = planet.position.x;
                const fromY = planet.position.y;
                const toX = target.position.x;
                const toY = target.position.y;

                const angle = Math.atan2(toY - fromY, toX - fromX);
                const startX = fromX + Math.cos(angle) * (planet.size + 5);
                const startY = fromY + Math.sin(angle) * (planet.size + 5);
                const endX = toX - Math.cos(angle) * (target.size + 5);
                const endY = toY - Math.sin(angle) * (target.size + 5);

                ctx.strokeStyle = conn.bidirectional ? '#4a5568' : '#2d3748';
                ctx.lineWidth = conn.bidirectional ? 2 : 1.5;
                ctx.globalAlpha = 0.6;

                ctx.beginPath();
                ctx.moveTo(startX, startY);
                ctx.lineTo(endX, endY);
                ctx.stroke();

                const midX = (startX + endX) / 2;
                const midY = (startY + endY) / 2;

                if (conn.bidirectional) {
                    const arrowSize = 8;

                    ctx.fillStyle = '#4a5568';
                    ctx.beginPath();
                    ctx.arc(midX, midY, arrowSize / 2, 0, Math.PI * 2);
                    ctx.fill();
                } else {
                    const arrowSize = 10;
                    const arrowAngle = Math.PI / 6;

                    ctx.fillStyle = '#2d3748';
                    ctx.beginPath();
                    ctx.moveTo(midX, midY);
                    ctx.lineTo(
                        midX - arrowSize * Math.cos(angle - arrowAngle),
                        midY - arrowSize * Math.sin(angle - arrowAngle)
                    );
                    ctx.lineTo(
                        midX - arrowSize * Math.cos(angle + arrowAngle),
                        midY - arrowSize * Math.sin(angle + arrowAngle)
                    );
                    ctx.closePath();
                    ctx.fill();
                }

                ctx.globalAlpha = 1;
            }
        }
    }

    render() {
        ctx.fillStyle = '#0a0e27';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        ctx.translate(this.camera.x, this.camera.y);
        ctx.scale(this.camera.zoom, this.camera.zoom);

        ctx.strokeStyle = '#1a1e3a';
        ctx.lineWidth = 1 / this.camera.zoom;
        const gridStart = -this.camera.x / this.camera.zoom;
        const gridEnd = (canvas.width - this.camera.x) / this.camera.zoom;
        for (let i = Math.floor(gridStart / 50) * 50; i < gridEnd; i += 50) {
            ctx.beginPath();
            ctx.moveTo(i, -this.camera.y / this.camera.zoom);
            ctx.lineTo(i, (canvas.height - this.camera.y) / this.camera.zoom);
            ctx.stroke();
        }
        const gridStartY = -this.camera.y / this.camera.zoom;
        const gridEndY = (canvas.height - this.camera.y) / this.camera.zoom;
        for (let i = Math.floor(gridStartY / 50) * 50; i < gridEndY; i += 50) {
            ctx.beginPath();
            ctx.moveTo(-this.camera.x / this.camera.zoom, i);
            ctx.lineTo((canvas.width - this.camera.x) / this.camera.zoom, i);
            ctx.stroke();
        }

        this.drawConnections();

        const reachableIds = this.getPlayerReachablePlanetIds();

        for (const planet of this.planets) {
            const isDimmed = !reachableIds.has(planet.id);
            planet.draw(ctx, false, isDimmed);
        }

        for (const ship of this.ships) {
            if (ship.health > 0) {
                ship.draw(ctx);
            }
        }

        if (this.targetPlanets.length > 0) {
            for (const target of this.targetPlanets) {
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2 / this.camera.zoom;
                ctx.setLineDash([5 / this.camera.zoom, 5 / this.camera.zoom]);
                ctx.beginPath();
                ctx.arc(target.position.x, target.position.y, 15, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }

        ctx.restore();

        this.updateUI();
        this.updateUpgradeUI();
    }

    updateUI() {
        const statsDiv = document.getElementById('teamStats');
        const teams = ['team1', 'team2', 'team3', 'team4', 'team5'];

        let html = '';
        for (const team of teams) {
            const planets = this.planets.filter(p => p.team === team).length;
            const ships = this.ships.filter(s => s.team === team && s.health > 0).length;
            const maxFleet = this.getMaxFleet(team);
            const color = TEAM_COLORS[team];

            if (planets > 0 || ships > 0) {
                html += `<div style="color: ${color}">
                    <strong>${TEAM_NAMES[team]}:</strong> ${planets} planets, ${ships}/${maxFleet} ships
                </div>`;
            }
        }

        statsDiv.innerHTML = html;
    }

    gameLoop() {
        if (this.stopped) return;
        const now = Date.now();
        const speedMultiplier = this.settings.speedMultiplier || 1;
        const dt = Math.min((now - this.lastTime) / 1000, 0.1) * speedMultiplier;
        this.lastTime = now;

        this.update(dt);

        // Render every N frames based on speed multiplier to reduce load
        // At 1x: render every frame
        // At 10x: render every 5 frames
        // At 50x: render every 10 frames
        const renderInterval = Math.max(1, Math.floor(speedMultiplier / 2));
        this.frameCounter++;

        if (this.frameCounter >= renderInterval) {
            this.render();
            this.frameCounter = 0;
        }

        requestAnimationFrame(() => this.gameLoop());
    }

    render() {
    ctx.fillStyle = '#0a0e27';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(this.camera.x, this.camera.y);
    ctx.scale(this.camera.zoom, this.camera.zoom);

    ctx.strokeStyle = '#1a1e3a';
    ctx.lineWidth = 1 / this.camera.zoom;
    const gridStart = -this.camera.x / this.camera.zoom;
    const gridEnd = (canvas.width - this.camera.x) / this.camera.zoom;
    for (let i = Math.floor(gridStart / 50) * 50; i < gridEnd; i += 50) {
        ctx.beginPath();
        ctx.moveTo(i, -this.camera.y / this.camera.zoom);
        ctx.lineTo(i, (canvas.height - this.camera.y) / this.camera.zoom);
        ctx.stroke();
    }
    const gridStartY = -this.camera.y / this.camera.zoom;
    const gridEndY = (canvas.height - this.camera.y) / this.camera.zoom;
    for (let i = Math.floor(gridStartY / 50) * 50; i < gridEndY; i += 50) {
        ctx.beginPath();
        ctx.moveTo(-this.camera.x / this.camera.zoom, i);
        ctx.lineTo((canvas.width - this.camera.x) / this.camera.zoom, i);
        ctx.stroke();
    }

    this.drawConnections();

    const reachableIds = this.getPlayerReachablePlanetIds();

    for (const planet of this.planets) {
        const isDimmed = !reachableIds.has(planet.id);
        planet.draw(ctx, false, isDimmed);
    }

    for (const ship of this.ships) {
        if (ship.health > 0) {
            ship.draw(ctx);
        }
    }

    if (this.targetPlanets.length > 0) {
        for (const target of this.targetPlanets) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2 / this.camera.zoom;
            ctx.setLineDash([5 / this.camera.zoom, 5 / this.camera.zoom]);
            ctx.beginPath();
            ctx.arc(target.position.x, target.position.y, 15, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    ctx.restore();

    this.updateUI();
    this.updateUpgradeUI();
}

updateUI() {
    const statsDiv = document.getElementById('teamStats');
    const teams = ['team1', 'team2', 'team3', 'team4', 'team5'];

    let html = '';
    for (const team of teams) {
        const planets = this.planets.filter(p => p.team === team).length;
        const ships = this.ships.filter(s => s.team === team && s.health > 0).length;
        const maxFleet = this.getMaxFleet(team);
        const color = TEAM_COLORS[team];

        if (planets > 0 || ships > 0) {
            html += `<div style="color: ${color}">
                <strong>${TEAM_NAMES[team]}:</strong> ${planets} planets, ${ships}/${maxFleet} ships
            </div>`;
        }
    }

        statsDiv.innerHTML = html;
    }
}

let game = null;

function initializeStartMenu() {
    const galaxySize = document.getElementById('galaxySize');
    const playerCount = document.getElementById('playerCount');
    const aiOnlyMode = document.getElementById('aiOnlyMode');
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

    // Hide team stats when DEBUG is false
    if (!DEBUG) {
        const teamStatsContainer = document.getElementById('teamStatsContainer');
        if (teamStatsContainer) {
            teamStatsContainer.style.display = 'none';
        }
    }

    // Controls modal functionality
    controlsButton.addEventListener('click', () => {
        controlsModal.classList.remove('hidden');
    });

    closeControlsButton.addEventListener('click', () => {
        controlsModal.classList.add('hidden');
        // If pause menu is hidden (game is paused), show it again
        if (game && game.paused) {
            pauseMenu.classList.remove('hidden');
            // UI stays hidden
        } else if (game) {
            // If game is running and not paused, show UI
            document.getElementById('ui').classList.remove('hidden');
        }
    });

    // Only show batch test options if DEBUG is enabled
    const debugEnabled = DEBUG;

    // Show/hide batch test options when AI-Only mode is toggled
    aiOnlyMode.addEventListener('change', () => {
        if (aiOnlyMode.checked && debugEnabled) {
            batchTestOptions.style.display = 'block';
            batchTestOptions.classList.remove('hidden');
        } else {
            batchTestOptions.style.display = 'none';
            batchTestOptions.classList.add('hidden');
            batchTestMode.checked = false;
            batchTestConfig.classList.add('hidden');
        }
    });

    // Show/hide batch test config when batch test mode is toggled
    batchTestMode.addEventListener('change', () => {
        if (batchTestMode.checked) {
            batchTestConfig.classList.remove('hidden');
        } else {
            batchTestConfig.classList.add('hidden');
        }
    });

    function validateSettings() {
        const size = galaxySize.value;
        const players = parseInt(playerCount.value);

        const maxPlayers = {
            small: 3,
            medium: 4,
            large: 5,
            huge: 5
        };

        if (players > maxPlayers[size]) {
            warning.classList.remove('hidden');
            startButton.disabled = true;
            startButton.classList.add('opacity-50', 'cursor-not-allowed');
            return false;
        } else {
            warning.classList.add('hidden');
            startButton.disabled = false;
            startButton.classList.remove('opacity-50', 'cursor-not-allowed');
            return true;
        }
    }

    galaxySize.addEventListener('change', validateSettings);
    playerCount.addEventListener('change', validateSettings);

    startButton.addEventListener('click', () => {
        if (!validateSettings()) return;

        const settings = {
            galaxySize: galaxySize.value,
            playerCount: parseInt(playerCount.value),
            aiOnlyMode: aiOnlyMode.checked,
            batchTestMode: batchTestMode.checked,
            speedMultiplier: batchTestMode.checked ? (parseInt(speedMultiplier.value) || 10) : 1
        };

        // Initialize batch testing if enabled
        if (settings.batchTestMode) {
            window.totalTestGames = parseInt(batchTestCount.value) || 10;
            window.currentTestGame = 1;
            window.batchTestResults = [];
            console.log(`\n🧪 Starting batch test: ${window.totalTestGames} games at ${settings.speedMultiplier}x speed\n`);
        }

        document.getElementById('startMenu').classList.add('hidden');
        document.getElementById('ui').classList.remove('hidden');

        if (settings.aiOnlyMode) {
            document.getElementById('upgradePanel').classList.add('hidden');
        }

        game = new Game(settings);
    });

    validateSettings();
}

function startGame() {
    const batchTestMode = document.getElementById('batchTestMode');
    const speedMultiplier = document.getElementById('speedMultiplier');

    const settings = {
        galaxySize: document.getElementById('galaxySize').value,
        playerCount: parseInt(document.getElementById('playerCount').value),
        aiOnlyMode: document.getElementById('aiOnlyMode').checked,
        batchTestMode: batchTestMode.checked,
        speedMultiplier: batchTestMode.checked ? (parseInt(speedMultiplier.value) || 10) : 1
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
        if (game) {
            game.paused = true;
            pauseMenu.classList.remove('hidden');
            document.getElementById('ui').classList.add('hidden');
        }
    });

    resumeButton.addEventListener('click', () => {
        if (game) {
            game.paused = false;
            pauseMenu.classList.add('hidden');
            document.getElementById('ui').classList.remove('hidden');
        }
    });

    pauseExitButton.addEventListener('click', () => {
        location.reload();
    });

    pauseControlsButton.addEventListener('click', () => {
        pauseMenu.classList.add('hidden');
        controlsModal.classList.remove('hidden');
        // UI stays hidden while controls modal is open
    });

    // Also handle space key for pause
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && game && !game.gameOver) {
            e.preventDefault();
            if (game.paused) {
                game.paused = false;
                pauseMenu.classList.add('hidden');
                document.getElementById('ui').classList.remove('hidden');
            } else {
                game.paused = true;
                pauseMenu.classList.remove('hidden');
                document.getElementById('ui').classList.add('hidden');
            }
        }
    });
}

function setupDownloadLogsButton() {
    const downloadButton = document.getElementById('downloadLogsButton');
    if (downloadButton) {
        if (!DEBUG) {
            downloadButton.style.display = 'none';
        } else {
            downloadButton.addEventListener('click', () => {
                if (game) {
                    // Hide button during batch testing
                    if (game.settings.speedMultiplier > 1) {
                        alert('AI logs are disabled during speed testing for performance.');
                        return;
                    }
                    game.downloadAILogs();
                } else {
                    alert('No game running - start a game first!');
                }
            });
        }
    }
}

initializeStartMenu();
setupPauseMenu();
setupDownloadLogsButton();
