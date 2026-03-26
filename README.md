# ⭐ Stellar Conquest

A real-time browser-based space strategy game where teams of ships battle for control of a procedurally generated galaxy. Play against AI opponents or watch AI teams fight it out in idle/batch mode.

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

## Game Modes

### Standard (Player vs AI)
You control the **Green Alliance** (Team 1) against up to 4 AI opponents. Earn points by holding planets and destroying enemies, then spend them on upgrades.

### AI-Only Mode
Watch all teams battle autonomously. No player input required. Enables **Idle Mode**.

### Idle Mode
Continuously loops AI games forever — ideal for use as a screensaver or display. Enable via the start menu (requires AI-Only mode) or via URL flag:

```
?idle=1&size=medium&teams=4
```

URL parameters:
- `idle=1` — start immediately in idle mode
- `size` — `small`, `medium`, `large`, or `huge`
- `teams` — `2` through `5`

### Batch Test Mode *(DEBUG only)*
Runs a set number of AI games back-to-back at high speed and exports results as a JSON file.

## Teams

| Team | Name | Default Strategy |
|------|------|-----------------|
| 1 | Green Alliance | Player controlled |
| 2 | Red Empire | Aggressive (attack-focused) |
| 3 | Blue Federation | Tanky (defense-focused) |
| 4 | Gold Collective | Balanced |
| 5 | Purple Dynasty | Fast (speed-focused) |

## Upgrades

Earn tokens by accumulating points. Spend them on:
- ⚔️ **Attack** — increases ship damage
- 🛡️ **Defense** — increases ship health, planet HP, fleet cap, and production speed
- ⚡ **Speed** — increases ship movement speed

## Galaxy Sizes

| Size | Planets | Feel |
|------|---------|------|
| Small | 20 | Quick game |
| Medium | 30 | Balanced |
| Large | 40 | Extended campaign |
| Huge | 50 | Epic scale |

## Setup

No build step required. Serve the `Web` folder with any static file server:

```bash
npx serve Web
# or
python -m http.server 8080 --directory Web
```

Then open `http://localhost:8080` in your browser.

## Deployment

The project deploys automatically to GitHub Pages via GitHub Actions on every push to `main`. The `Web` folder is used as the publish directory.
