# ⭐ Stellar Conquest

A high-performance real-time browser-based space strategy game where teams of ships battle for control of a procedurally generated galaxy. Play against AI opponents or watch AI teams fight it out in idle/batch mode.

Built with WebGL2 for hardware-accelerated rendering, featuring instanced rendering, spatial hash grids, and preallocated typed-array scratch buffers on the simulation hot paths for smooth gameplay even with hundreds of ships.

## Gameplay

Conquer planets by sending your ships to attack enemy and neutral planets. Captured planets produce new ships and contribute to your fleet capacity. Upgrade your fleet's attack, defense, and speed stats as you earn points. The last team standing wins.

Ships automatically defend their home planets and engage nearby enemies. You direct the attack by clicking target planets.

## Controls

| Input | Action |
|-------|--------|
| Click planet | Send all ships to attack (planet must be connected to one of yours) |
| Click empty space | Send all ships to that position |
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
- **Hard (0.5x)** — Moderate difficulty
- **Very Hard (0.75x)** — Tough opponents
- **Extreme (1.0x)** — AI earns tokens at the same rate as the player

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

### Batch Test Mode *(debug only)*
Runs a set number of AI games back-to-back at high speed and exports results as a JSON file. Useful for testing game balance and AI strategies.

Debug tooling (batch testing and the live team stats panel) is hidden on public deployments. Enable it by running on `localhost` or by adding `?debug=1` to the URL.

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
- 🛡️ **Defense** — reduces incoming damage, speeds up ship/planet regeneration, and increases planet HP, fleet capacity, and production speed
- ⚡ **Speed** — increases ship movement speed

In player mode, you earn points at full rate while AI teams earn at a reduced rate based on difficulty. In AI-only mode, all teams earn at the same rate.

## Technical Features

### Performance Optimizations
- **WebGL2 Instanced Rendering** — Hardware-accelerated rendering of hundreds of ships with a single draw call
- **Struct-of-Arrays (SoA)** — Cache-friendly data layout for ship properties
- **Spatial Hash Grid** — O(1) neighbor queries for combat and collision detection
- **Object Pooling** — Ship slots are recycled and hot loops use preallocated scratch buffers, keeping per-frame garbage minimal
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

AI teams dynamically adjust their behaviour based on:
- Territory control and fleet strength
- Threat assessment from nearby enemies
- Strategic planet targeting (weak targets, high-value planets)
- Defensive responses to incoming attacks

## Audio

Audio is wired up but ships without assets. Drop the files listed in
[`web/audio/AUDIO.md`](web/audio/AUDIO.md) into `web/audio/` and they are picked up
automatically; any missing file is silently skipped. Sound and music can be toggled
in the pause menu and the choice is remembered in `localStorage`.

Sound effects and music are from [Pixabay](https://pixabay.com), used under the
[Pixabay Content License](https://pixabay.com/service/license-summary/).

## Setup

No build step required to run. Serve the `web` folder with any static file server:

```bash
npx serve web
# or
python -m http.server 8080 --directory web
```

Then open `http://localhost:8080` in your browser.

The Tailwind stylesheet is committed as `web/css/tailwind.css` (the CDN build is not
meant for production). Regenerate it after changing markup or class names:

```bash
npx tailwindcss@3 -i web/css/tailwind.src.css -o web/css/tailwind.css \
  --content 'web/index.html,web/js/*.js' --minify
```

## Deployment

The project deploys automatically to GitHub Pages via GitHub Actions on every push to `main`. The `web` folder is used as the publish directory.

## Project Structure

```
Stellar-Conquest/
├── web/
│   ├── index.html             # Main HTML with UI elements
│   ├── favicon.svg
│   ├── audio/
│   │   └── AUDIO.md           # Expected audio filenames and when they play
│   ├── css/
│   │   ├── tailwind.src.css   # Tailwind entry point (source)
│   │   └── tailwind.css       # Generated stylesheet served by the page
│   └── js/
│       ├── game.js            # Core game logic, AI, and rendering
│       ├── audio.js           # Audio manager and clip manifest
│       └── webgl-renderer.js  # WebGL2 instanced renderer
├── DESIGN.md
├── LICENSE
└── README.md
```

## Credits

- Audio: sound effects and music from [Pixabay](https://pixabay.com)
  ([Pixabay Content License](https://pixabay.com/service/license-summary/)).

## License

[MIT](LICENSE) - feel free to use, modify, and distribute.
