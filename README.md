# Digimon Terminus — launcher channel

Update channel for the Digimon Terminus launcher (`DigimonTerminus.Launcher.exe`), which starts the Unity client (`DigimonTerminus.exe`).

| Path | What |
|---|---|
| `launcher/` | The launcher's face: the HTML page the launcher renders (served by GitHub Pages at `https://reapper-stack.github.io/terminus-launcher/launcher/`). Changing it is a push; no client release needed. |
| `launcher-src/` | Design source of the page (`build_prod.py` writes `launcher/`). |
| `manifest/` | The signed launcher manifest and its `.sig` (launcher self-update and the game version). Not published yet. |

The game itself is not hosted here: it ships as one archive the launcher downloads and unpacks.

Replaces the retired Gamebryo feed `Reapper-Stack/digimon-terminus-releases`.
