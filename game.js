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
    constructor(id, x, y, team, maxHealth, productionRate, capacityContribution) {
        this.id = id;
        this.team = team;
        this.position = { x, y };
        this.health = maxHealth;
        this.maxHealth = maxHealth;
        this.productionRate = productionRate;
        this.capacityContribution = capacityContribution;
        this.regenRate = BASE_PLANET_REGEN;
        this.productionTimer = 0;
        this.size = 20 + (maxHealth / 50);
    }

    update(dt, teamDefenseLevel) {
        this.health = Math.min(this.health + this.regenRate * teamDefenseLevel * dt, this.maxHealth);

        if (this.team !== 'neutral') {
            this.productionTimer += dt;
        }
    }

    takeDamage(damage, attackerTeam) {
        this.health -= damage;
        if (this.health <= 0) {
            this.team = attackerTeam;
            this.health = this.maxHealth * 0.25;
            this.productionTimer = 0;
            return true;
        }
        return false;
    }

    draw(ctx, isSelected = false) {
        const color = TEAM_COLORS[this.team];

        if (isSelected) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(this.position.x, this.position.y, this.size + 10, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(this.position.x, this.position.y, this.size, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.arc(this.position.x, this.position.y, this.size + 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;

        const healthPercent = this.health / this.maxHealth;
        const barWidth = this.size * 2;
        const barHeight = 4;
        const barX = this.position.x - barWidth / 2;
        const barY = this.position.y + this.size + 10;

        ctx.fillStyle = '#333';
        ctx.fillRect(barX, barY, barWidth, barHeight);
        ctx.fillStyle = color;
        ctx.fillRect(barX, barY, barWidth * healthPercent, barHeight);
    }
}

class Ship {
    constructor(id, team, x, y, stats) {
        this.id = id;
        this.team = team;
        this.position = { x, y };
        this.velocity = { x: 0, y: 0 };
        this.target = null;
        this.health = 100;
        this.maxHealth = 100;
        this.attack = stats.attack;
        this.defense = stats.defense;
        this.speed = stats.speed;
        this.attackCooldown = ATTACK_COOLDOWN;
        this.nextAttackTime = 0;
        this.regenRate = BASE_REGEN;
    }

    update(dt, planets, ships, teamDefenseLevel) {
        this.health = Math.min(this.health + this.regenRate * teamDefenseLevel * dt, this.maxHealth);

        if (this.target) {
            const targetPos = this.target.position;
            const distance = Vector2.distance(this.position, targetPos);

            if (distance > 5) {
                const direction = Vector2.normalize(Vector2.subtract(targetPos, this.position));
                this.velocity.x = direction.x * this.speed;
                this.velocity.y = direction.y * this.speed;
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

        const nearbyEnemyShip = this.findNearestEnemyShip(ships);
        if (nearbyEnemyShip && Vector2.distance(this.position, nearbyEnemyShip.position) <= ATTACK_RANGE) {
            if (Date.now() / 1000 >= this.nextAttackTime) {
                this.engageCombat(nearbyEnemyShip);
                this.nextAttackTime = Date.now() / 1000 + this.attackCooldown;
            }
        } else if (this.target && (this.target.team !== this.team && this.target.team !== 'neutral' ||
                   (this.target instanceof Planet && this.target.team === 'neutral'))) {
            const distanceToTarget = Vector2.distance(this.position, this.target.position);
            if (distanceToTarget <= ATTACK_RANGE) {
                if (Date.now() / 1000 >= this.nextAttackTime) {
                    if (this.target instanceof Planet) {
                        this.attackPlanet(this.target);
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
            if (ship.id > this.id) continue;

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
                ship.position.x -= pushX;
                ship.position.y -= pushY;
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

    engageCombat(enemy) {
        const powerA = this.attack / enemy.defense;
        const powerB = enemy.attack / this.defense;
        const pA = powerA / (powerA + powerB);

        if (Math.random() < pA) {
            this.dealDamage(enemy);
        } else {
            enemy.dealDamage(this);
        }
    }

    dealDamage(target) {
        const raw = this.attack;
        const mitigated = raw * (this.attack / (this.attack + target.defense));
        target.health -= mitigated;
    }

    attackPlanet(planet) {
        const damage = this.attack * 0.5;
        planet.takeDamage(damage, this.team);
    }

    draw(ctx) {
        const color = TEAM_COLORS[this.team];

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(this.position.x, this.position.y - 6);
        ctx.lineTo(this.position.x - 4, this.position.y + 4);
        ctx.lineTo(this.position.x + 4, this.position.y + 4);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.stroke();
    }
}

class Game {
    constructor() {
        this.planets = [];
        this.ships = [];
        this.teams = {
            neutral: { attack: 10, defense: 10, speed: SHIP_SPEED },
            team1: { attack: 12, defense: 10, speed: SHIP_SPEED },
            team2: { attack: 15, defense: 8, speed: SHIP_SPEED * 1.1 },
            team3: { attack: 10, defense: 15, speed: SHIP_SPEED * 0.9 },
            team4: { attack: 13, defense: 12, speed: SHIP_SPEED },
            team5: { attack: 11, defense: 11, speed: SHIP_SPEED }
        };

        this.targetPlanets = [];
        this.nextShipId = 0;
        this.paused = false;
        this.gameOver = false;
        this.winner = null;

        this.initializePlanets();
        this.setupEventListeners();

        this.lastTime = Date.now();
        this.gameLoop();
    }

    initializePlanets() {
        const w = canvas.width;
        const h = canvas.height;
        const margin = 100;

        this.planets.push(new Planet(0, w * 0.2, h * 0.5, 'team1', 200, 1, CAP_AMNT));
        this.planets.push(new Planet(1, w * 0.8, h * 0.5, 'team2', 200, 1, CAP_AMNT));

        this.planets.push(new Planet(2, w * 0.5, h * 0.3, 'neutral', 150, 1, CAP_AMNT));
        this.planets.push(new Planet(3, w * 0.5, h * 0.7, 'neutral', 150, 1, CAP_AMNT));
        this.planets.push(new Planet(4, w * 0.35, h * 0.35, 'neutral', 100, 1, CAP_AMNT));
        this.planets.push(new Planet(5, w * 0.65, h * 0.35, 'neutral', 100, 1, CAP_AMNT));
        this.planets.push(new Planet(6, w * 0.35, h * 0.65, 'neutral', 100, 1, CAP_AMNT));
        this.planets.push(new Planet(7, w * 0.65, h * 0.65, 'neutral', 100, 1, CAP_AMNT));

        for (let i = 0; i < 3; i++) {
            this.spawnShipAtPlanet(this.planets[0]);
            this.spawnShipAtPlanet(this.planets[1]);
        }
    }

    setupEventListeners() {
        canvas.addEventListener('click', (e) => this.handleClick(e));

        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space') {
                e.preventDefault();
                this.paused = !this.paused;
            }
        });

        document.getElementById('restartButton').addEventListener('click', () => {
            location.reload();
        });
    }

    handleClick(e) {
        if (this.gameOver) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        let clickedPlanet = null;
        for (const planet of this.planets) {
            const dist = Vector2.distance({ x, y }, planet.position);
            if (dist <= planet.size) {
                clickedPlanet = planet;
                break;
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

    assignShipsToTargets() {
        if (this.targetPlanets.length === 0) return;

        const playerShips = this.ships.filter(s => s.team === 'team1');

        if (this.targetPlanets.length === 1) {
            this.assignShipsToSingleTarget(playerShips, this.targetPlanets[0]);
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
            }

            for (let i = 0; i < this.targetPlanets.length; i++) {
                this.assignShipsToSingleTarget(assignments[i], this.targetPlanets[i]);
            }
        }
    }

    assignShipsToSingleTarget(ships, target) {
        const basePos = target.position;
        const shipCount = ships.length;

        if (shipCount === 0) return;

        const isTargetPlanet = target instanceof Planet;
        const minRadius = isTargetPlanet ? target.size + PLANET_CLEARANCE + 10 : 0;

        const shipsPerRing = 12;
        let currentRing = 0;
        let positionInRing = 0;

        for (let i = 0; i < shipCount; i++) {
            const ring = Math.floor(i / shipsPerRing);
            const indexInRing = i % shipsPerRing;
            const shipsInThisRing = Math.min(shipsPerRing, shipCount - ring * shipsPerRing);

            const radius = minRadius + ring * SHIP_SPACING * 2;
            const angle = (indexInRing / shipsInThisRing) * Math.PI * 2;

            const offsetX = Math.cos(angle) * radius;
            const offsetY = Math.sin(angle) * radius;

            ships[i].target = {
                position: {
                    x: basePos.x + offsetX,
                    y: basePos.y + offsetY
                },
                team: target.team
            };
        }
    }

    spawnShipAtPlanet(planet) {
        const angle = Math.random() * Math.PI * 2;
        const distance = planet.size + 15;
        const x = planet.position.x + Math.cos(angle) * distance;
        const y = planet.position.y + Math.sin(angle) * distance;

        const ship = new Ship(this.nextShipId++, planet.team, x, y, this.teams[planet.team]);
        this.ships.push(ship);
        return ship;
    }

    getMaxFleet(team) {
        const ownedPlanets = this.planets.filter(p => p.team === team).length;
        return BASE_CAP + (ownedPlanets * CAP_AMNT);
    }

    updateProduction(dt) {
        for (const planet of this.planets) {
            if (planet.team === 'neutral') continue;

            const teamShips = this.ships.filter(s => s.team === planet.team && s.health > 0).length;
            const maxFleet = this.getMaxFleet(planet.team);

            if (teamShips < maxFleet && planet.productionTimer >= PRODUCTION_INTERVAL) {
                this.spawnShipAtPlanet(planet);
                planet.productionTimer = 0;
            }
        }
    }

    updateAI(dt) {
        const aiTeams = ['team2', 'team3', 'team4', 'team5'];

        for (const team of aiTeams) {
            const teamPlanets = this.planets.filter(p => p.team === team);
            if (teamPlanets.length === 0) continue;

            if (Math.random() < 0.02) {
                const teamShips = this.ships.filter(s => s.team === team && s.health > 0);
                if (teamShips.length > 5) {
                    const neutralPlanets = this.planets.filter(p => p.team === 'neutral');
                    const enemyPlanets = this.planets.filter(p => p.team !== team && p.team !== 'neutral');

                    let target = null;
                    if (neutralPlanets.length > 0 && Math.random() < 0.6) {
                        target = neutralPlanets[Math.floor(Math.random() * neutralPlanets.length)];
                    } else if (enemyPlanets.length > 0) {
                        target = enemyPlanets[Math.floor(Math.random() * enemyPlanets.length)];
                    }

                    if (target) {
                        for (const ship of teamShips) {
                            ship.target = target;
                        }
                    }
                }
            }
        }
    }

    checkWinConditions() {
        const activTeams = new Set();

        for (const planet of this.planets) {
            if (planet.team !== 'neutral') {
                activTeams.add(planet.team);
            }
        }

        for (const ship of this.ships) {
            if (ship.health > 0 && ship.team !== 'neutral') {
                activTeams.add(ship.team);
            }
        }

        if (activTeams.size === 1) {
            this.gameOver = true;
            this.winner = Array.from(activTeams)[0];
            this.showGameOver();
        } else if (activTeams.size === 0) {
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

    update(dt) {
        if (this.paused || this.gameOver) return;

        for (const planet of this.planets) {
            const defenseLevel = planet.team !== 'neutral' ? this.teams[planet.team].defense / 10 : 1;
            planet.update(dt, defenseLevel);
        }

        for (const ship of this.ships) {
            if (ship.health > 0) {
                const defenseLevel = this.teams[ship.team].defense / 10;
                ship.update(dt, this.planets, this.ships, defenseLevel);
            }
        }

        this.ships = this.ships.filter(s => s.health > 0);

        this.updateProduction(dt);
        this.updateAI(dt);
        this.checkWinConditions();
    }

    render() {
        ctx.fillStyle = '#0a0e27';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.strokeStyle = '#1a1e3a';
        ctx.lineWidth = 1;
        for (let i = 0; i < canvas.width; i += 50) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i, canvas.height);
            ctx.stroke();
        }
        for (let i = 0; i < canvas.height; i += 50) {
            ctx.beginPath();
            ctx.moveTo(0, i);
            ctx.lineTo(canvas.width, i);
            ctx.stroke();
        }

        for (const planet of this.planets) {
            planet.draw(ctx, false);
        }

        for (const ship of this.ships) {
            if (ship.health > 0) {
                ship.draw(ctx);
            }
        }

        if (this.targetPlanets.length > 0) {
            for (const target of this.targetPlanets) {
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 5]);
                ctx.beginPath();
                ctx.arc(target.position.x, target.position.y, 15, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }

        this.updateUI();
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
        const now = Date.now();
        const dt = Math.min((now - this.lastTime) / 1000, 0.1);
        this.lastTime = now;

        this.update(dt);
        this.render();

        requestAnimationFrame(() => this.gameLoop());
    }
}

const game = new Game();
