# Audio Assets

Drop audio files into this folder (`web/audio/`) using the exact filenames below.
Everything is optional: any file that is missing is silently skipped, so the game
runs normally with a partially filled folder.

Wiring lives in [`web/js/audio.js`](../js/audio.js) (`AUDIO_CLIPS`). Add or rename a
clip there if you want different filenames.

## Music

| File | Label | Loops | Default volume | Plays when |
| --- | --- | --- | --- | --- |
| `music_menu.mp3` | Menu theme | no | 0.40 | Start menu is visible (and after exiting to menu) |
| `music_battle.mp3` | Battle theme | yes | 0.35 | A game is running |

## Sound effects

| File | Label | Default volume | Plays when |
| --- | --- | --- | --- |
| `ui_click.mp3` | UI click | 0.50 | Any menu / pause / upgrade button is pressed |
| `ship_attack.mp3` | Ship weapon fire | 0.25 | A ship fires at another ship (throttled to ~12/s) |
| `ship_destroyed.mp3` | Ship destroyed | 0.35 | A ship is killed (throttled to ~16/s) |
| `planet_captured.mp3` | Planet captured | 0.60 | The player captures a planet |
| `planet_lost.mp3` | Planet lost | 0.60 | The player loses a planet to an AI |
| `upgrade.mp3` | Upgrade purchased | 0.60 | An attack / defense / speed token is spent |
| `victory.mp3` | Victory sting | 0.70 | The player wins |
| `defeat.mp3` | Defeat sting | 0.70 | The player loses |

## Attribution

Sound effects and music are from [Pixabay](https://pixabay.com), used under the
[Pixabay Content License](https://pixabay.com/service/license-summary/). If you replace a
clip with one from another source, credit it here too.

## Notes

- Format: `.mp3` is assumed for broad browser support; `.ogg`/`.wav` also work if you
  update the filenames in `AUDIO_CLIPS`.
- Keep effects short (< 1s) and normalized; the per-clip volumes above are applied on
  top of the file's own level.
- Frequently-triggered effects use a small pool of elements so overlapping plays don't
  cut each other off, plus a minimum interval to avoid machine-gunning during big fights.
- Browsers block playback until the first user interaction; music starts automatically
  on the first click or keypress.
- Sound / music toggles are in the pause menu and persist in `localStorage`
  (`stellarConquest.sound`, `stellarConquest.music`).
