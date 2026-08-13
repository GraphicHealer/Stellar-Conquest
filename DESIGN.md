# 📄 Stellar Conquest — Technical Specification

## Overview

This document describes the mechanics and architecture of Stellar Conquest, a web-based
recreation of *Galaxy Wars* based on reverse-engineered gameplay behaviour. It reflects
what `web/js/game.js` actually implements; update it alongside the code.

The game is a **real-time, continuous-space RTS** where players control fleets of ships to capture planets and eliminate opponents.

---

# 🧠 Core Concepts

## Game Loop

1. Planets generate ships (up to global capacity)
2. Player issues movement commands
3. Ships travel in continuous space
4. Ships engage in combat
5. Ships attack planets
6. Planets regenerate health
7. Capture and elimination conditions are evaluated

---

# 🪐 Planet System

## Planet Properties

```ts
type Team = "neutral" | "team1" | "team2" | "team3" | "team4" | "team5";

interface Planet {
  id: number;
  team: Team;

  position: { x: number; y: number };

  health: number;
  maxHealth: number;

  productionRate: number;

  capacityContribution: number;

  regenRate: number;
}
```

---

## Planet Behavior

* Planets **do NOT attack**
* Planets:

  * Generate ships
  * Take damage
  * Regenerate health
* Planets are captured when:

```ts
if (planet.health <= 0) {
  // Only reachable planets can be captured: the attacking team must own a planet
  // with a connection to this one (teams with no planets left ignore this rule).
  planet.team = attacker.team;
  planet.health = planet.maxHealth * 0.75;
}
```

Planets are linked by generated connections; a team may only attack and capture planets
adjacent to one it owns. Unreachable planets are dimmed in the UI.

---

## Planet Regeneration

```ts
planet.health += planet.regenRate * dt;
```

Scaled by team defense:

```ts
planet.regenRate = BASE_PLANET_REGEN * team.defenseLevel;
```

---

# 🚀 Ship System

## Ship Properties

```ts
interface Ship {
  id: number;

  team: Team;

  position: { x: number; y: number };
  velocity: { x: number; y: number };

  target: Target;

  health: number;
  maxHealth: number;

  attack: number;
  defense: number;

  speed: number;

  attackCooldown: number;
  nextAttackTime: number;

  regenRate: number;
}
```

---

## Movement

Ships move freely in continuous space:

```ts
direction = normalize(target - position);
velocity = direction * speed;
position += velocity * dt;
```

---

# ⚙️ Fleet Capacity System

## Global Capacity

```ts
MAX_FLEET = BASE_CAP + (PLANETS_OWNED * CAP_AMNT)
                     + (defenseTokens * SHIP_CAP_PER_DEFENSE_TOKEN);
```

Capacity is tracked per team (not globally); neutral planets keep a small fixed garrison.

## Behavior

* Ships are only produced if:

```ts
totalShips < MAX_FLEET
```

* Each planet increases total capacity

---

# 🏭 Production System

```ts
if (totalShips < MAX_FLEET) {
  spawnShipAtPlanet(planet);
}
```

* Ships spawn near planets
* Ships idle until commanded

---

# 🎯 Input System

## Mode A — Single Target

* Select destination
* All ships move to that point

---

## Mode B — Multi-Target Split (Max 3 Targets)

Ships are distributed evenly across selected targets.

### Algorithm

```ts
for each ship:
  assign to target with:
    - lowest assigned count
    - biased toward closest distance
```

---

## Target Rules

Ships can move anywhere but only attack:

* Enemy ships
* Enemy planets
* Neutral planets

---

# ⚔️ Combat System

## Combat Model

* Combat is **tick-based** and **deterministic** (no per-duel dice roll)
* Each tick every ship is paired with its nearest enemy inside `ATTACK_RANGE`
* Closest pairs win the limited slots: at most `MAX_ATTACKERS_PER_TARGET` ships may
  focus the same target in a tick
* Each ship damages its own target on its own cooldown, so an even fight naturally
  becomes a mutual exchange

---

## Damage Calculation

```ts
function dealDamage(attacker, target) {
    const base = teamAttack[attacker.team] * 0.5;
    const def = teamDefense[target.team];
    const reduction = def / (def + 50);

    target.health -= base * (1 - reduction * 0.5);
}
```

A kill is idempotent: the first hit that drops a ship to zero recycles its pool slot and
awards the points; later hits in the same tick are ignored.

---

## Combat Timing

Each ship has a cooldown:

```ts
if (time >= nextAttackTime) {
    engageCombat(ship, ship.combatTarget);
    nextAttackTime = time + ATTACK_COOLDOWN;
}
```

---

# ❤️ Regeneration System

## Ships

```ts
ship.health += ship.regenRate * dt;
```

Scaled by defense:

```ts
ship.regenRate = BASE_REGEN * team.defenseLevel;
```

---

## Planets

```ts
planet.health += planet.regenRate * dt;
```

---

# 🎯 Targeting Logic

Ships prioritize:

1. Enemy ships in range
2. Enemy/neutral planets if no ships nearby

---

## Engagement Range

```ts
if (distance(A, B) <= attackRange) {
    engageCombat();
}
```

---

# 🧬 Team System

## Teams

* 5 teams + neutral
* All teams share identical mechanics
* Differ only in starting stats

---

## Stats

| Stat    | Effect                           |
| ------- | -------------------------------- |
| Attack  | Increases damage                 |
| Defense | Reduces damage + increases regen |
| Speed   | Increases movement speed         |

---

# 🧠 Elimination Rules

A team is eliminated only when:

```ts
noShips && noPlanets
```

---

## Important Behavior

* Players can survive with ships only
* Comebacks are possible

---

# 🔄 Game Loop

```ts
function gameLoop(dt) {
  updateProduction(dt);
  updateShips(dt);
  handleCombat(dt);
  handlePlanetDamage(dt);
  handleRegen(dt);
  checkWinConditions();
  render();
}
```

---

# ⚖️ Balance Variables

## Core Constants

```ts
BASE_CAP
CAP_AMNT
BASE_REGEN
BASE_PLANET_REGEN
ATTACK_COOLDOWN
ATTACK_RANGE
```

---

## Tuning Guidelines

| Variable | Effect             |
| -------- | ------------------ |
| Attack   | Burst damage       |
| Defense  | Sustain + regen    |
| Regen    | Comeback potential |
| Cooldown | Combat pacing      |
| Capacity | Game scale         |

---

# 🧱 Architecture Notes (Web)

## Stack

* Rendering: **WebGL2** with instanced draws, plus a Canvas2D overlay for text/rings
* No framework, no build step (Tailwind is precompiled into `web/css/tailwind.css`)
* Canvas2D fallback when WebGL2 is unavailable

---

## Performance Considerations

* Ship data lives in **struct-of-arrays** typed arrays with a free-list slot pool
* Spatial partitioning uses a **spatial hash grid** (rebuilt each tick for ships, built
  once for planets) for:

  * Ship proximity and collision checks
  * Combat target selection
  * AI threat detection
* Hot loops reuse preallocated scratch buffers and hoisted callbacks instead of
  allocating per tick

---

# 🔥 Key Design Insight

This game is:

> A continuous-space RTS driven by attrition combat and regeneration

Core gameplay emerges from:

* Movement timing
* Fleet distribution
* Focus fire (attacker limits per target)
* Recovery through regen

---

# 🚀 Suggested Build Order

## Phase 1

* Ship movement
* Planet capture (no combat)

## Phase 2

* Combat system

## Phase 3

* Production + capacity

## Phase 4

* Input system (multi-target split)

## Phase 5

* AI
