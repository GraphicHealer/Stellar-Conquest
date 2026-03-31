# ⭐ Stellar Conquest

A high-performance real-time browser-based space strategy game where teams of ships battle for control of a procedurally generated galaxy. Play against AI opponents or watch AI teams fight it out in idle/batch mode.

Built with WebGL2 for hardware-accelerated rendering, featuring instanced rendering, spatial hash grids, and zero per-frame allocations for smooth gameplay even with hundreds of ships.

## Gameplay

Conquer planets by sending your ships to attack enemy and neutral planets. Captured planets produce new ships and contribute to your fleet capacity. Upgrade your fleet's attack, defense, and speed stats as you earn points. The last team standing wins.

Ships automatically defend their home planets and engage nearby enemies. You direct the attack by clicking target planets.

## Controls

| Input | Action |
|-------|--------|
| Click planet | Send all ships to attack |
| Shift + Click | Add a second/third target (up to 3) |
| Mouse Wheel | Zoom in/out |
| Click & Drag | Pan camera |
| Space | Pause / Resume |

## Game Settings

### Galaxy Size
- **Small** — 20 planets, quick games
- **Medium** — 30 planets, balanced gameplay
- **Large** — 40 planets, extended campaigns
- **Huge** — 50 planets, epic scale battles

### Player Count
Choose 2-5 teams (limited by galaxy size). Each team starts with a home planet.

### AI Difficulty
Adjusts how quickly AI teams earn upgrade tokens:
- **Easy (0.1x)** — AI earns tokens very slowly
- **Normal (0.25x)** — Balanced challenge
- **Medium (0.5x)** — Moderate difficulty
- **Hard (0.75x)** — Tough opponents
- **Very Hard (1.0x)** — AI earns tokens at same rate as player

## Game Modes

### Standard (Player vs AI)
You control the **Green Alliance** (Team 1) against up to 4 AI opponents. Earn points by holding planets and destroying enemies, then spend them on upgrades.

### AI-Only Mode
Watch all teams battle autonomously. No player input required. Enables **Idle Mode** and **Batch Test Mode**.

### Idle Mode
Continuously loops AI games forever — ideal for use as a screensaver or display. Enable via the start menu (requires AI-Only mode) or via URL flag:

```
?idle=1&size=medium&teams=4&difficulty=0.5
```

URL parameters:
- `idle=1` — start immediately in idle mode
- `size` — `small`, `medium`, `large`, or `huge`
- `teams` — `2` through `5`
- `difficulty` — AI difficulty multiplier (e.g., `0.25`, `0.5`, `1.0`)

### Batch Test Mode *(DEBUG only)*
Runs a set number of AI games back-to-back at high speed and exports results as a JSON file. Useful for testing game balance and AI strategies.

## Teams

| Team | Name | Default Strategy |
|------|------|-----------------|
| 1 | Green Alliance | Player controlled |
| 2 | Red Empire | Aggressive (attack-focused) |
| 3 | Blue Federation | Tanky (defense-focused) |
| 4 | Gold Collective | Balanced |
| 5 | Purple Dynasty | Fast (speed-focused) |

## Upgrades

Earn tokens by accumulating points from holding planets and destroying enemy ships. The cost of each token increases as you earn more. Spend tokens on:
- ⚔️ **Attack** — increases ship damage output
- 🛡️ **Defense** — increases ship health, planet HP, fleet capacity, and production speed
- ⚡ **Speed** — increases ship movement speed

In player mode, you earn points at full rate while AI teams earn at a reduced rate based on difficulty. In AI-only mode, all teams earn at the same rate.

## Technical Features

### Performance Optimizations
- **WebGL2 Instanced Rendering** — Hardware-accelerated rendering of hundreds of ships with a single draw call
- **Struct-of-Arrays (SoA)** — Cache-friendly data layout for ship properties
- **Spatial Hash Grid** — O(1) neighbor queries for combat and collision detection
- **Object Pooling** — Zero per-frame allocations for smooth 60 FPS gameplay
- **Fixed Timestep** — Deterministic physics simulation independent of frame rate

### Rendering System
- **Dual Canvas** — WebGL2 main canvas for game objects + Canvas2D overlay for UI elements
- **Instanced Geometry** — Ships, planets, and connections rendered with minimal draw calls
- **Dynamic Camera** — Smooth zoom and pan with proper coordinate transforms

### AI System
Each AI team has a unique strategy:
- **Red Empire** — Aggressive expansion, prioritizes attack upgrades
- **Blue Federation** — Defensive play, focuses on defense tokens
- **Gold Collective** — Balanced approach across all upgrades
- **Purple Dynasty** — Speed-focused, rapid ship movement

AI teams dynamically adjust their behavior based on:
- Territory control and fleet strength
- Threat assessment from nearby enemies
- Strategic planet targeting (weak targets, high-value planets)
- Defensive responses to incoming attacks

## Setup

No build step required. Serve the `web` folder with any static file server:

```bash
npx serve web
# or
python -m http.server 8080 --directory web
```

Then open `http://localhost:8080` in your browser.

## Deployment

The project deploys automatically to GitHub Pages via GitHub Actions on every push to `main`. The `web` folder is used as the publish directory.

## Project Structure

```
GalaxyWarsWeb/
├── web/
│   ├── index.html          # Main HTML with UI elements
│   ├── js/
│   │   ├── game.js         # Core game logic, AI, and rendering
│   │   └── webgl-renderer.js  # WebGL2 instanced renderer
│   └── ...
├── backup/                 # Original implementation backups
└── README.md
```

## License

MIT License - feel free to use, modify, and distribute.
