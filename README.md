# ⭐ Stellar Conquest

A real-time space conquest strategy game built with vanilla JavaScript and HTML5 Canvas.

## 🎮 How to Play

1. Open `index.html` in a modern web browser
2. Click on your green planet to select it
3. Click anywhere on the map to send your ships there
4. Hold **Shift** and click up to 3 locations to split your fleet
5. Capture neutral planets and defeat enemy teams
6. Press **Space** to pause/resume

## 🎯 Objective

Conquer the galaxy by eliminating all enemy teams. A team is eliminated when they have no planets and no ships remaining.

## 🚀 Game Mechanics

### Planets
- Generate ships over time (up to fleet capacity)
- Regenerate health automatically
- Can be captured by reducing health to zero
- Larger planets have more health and contribute more to fleet capacity

### Ships
- Move in continuous space toward targets
- Engage in probabilistic combat with enemy ships
- Attack enemy and neutral planets
- Regenerate health over time
- Automatically target nearby enemies

### Combat System
- Probabilistic duels based on attack/defense ratios
- Winner deals damage (not instant kill)
- Ships have cooldowns between attacks
- Defense increases both damage mitigation and regeneration

### Fleet Capacity
- Base capacity: 20 ships
- Each owned planet adds 15 to max capacity
- Ships only spawn when below capacity limit

### Teams
- **Green Alliance** (You): Balanced stats
- **Red Empire**: High attack, low defense, fast
- **Blue Federation**: High defense, low attack, slow
- **Gold Collective**: Balanced with slight advantages
- **Purple Dynasty**: Perfectly balanced

## 🛠️ Technical Details

Built following the design specification in `DESIGN.md`:
- Continuous-space RTS mechanics
- Probabilistic combat system
- Fleet capacity management
- Ship production and regeneration
- Multi-target fleet splitting
- AI opponents with strategic behavior

## 🎨 Features

- Modern, clean UI with TailwindCSS
- Smooth canvas rendering
- Real-time strategy gameplay
- Multiple AI opponents
- Pause/resume functionality
- Victory/defeat conditions
- Responsive design

## 📋 Requirements

- Modern web browser with HTML5 Canvas support
- JavaScript enabled
- No build process or dependencies required

## 🚀 Quick Start

Simply open `index.html` in your browser and start playing!
