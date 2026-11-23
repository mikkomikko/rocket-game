# New game page: Arcade (two screens)

Decided 2026-11-23 from a throwaway prototype (`/proto/new-game/`, since deleted) that compared the old page with three new directions.

**Chosen: Arcade.** The page asks one thing per screen.

1. **How do you want to play?** Three big tiles: 1 player (against the computer), 2 players (split screen), Online (play a friend). Each tile shows the ships it puts in the game: a "CPU" tag on the computer's ship, and an empty grey ship for the online friend. A "Last played" tag marks the mode from last time, and that tile has focus, so Enter, Enter starts the same kind of game again.
2. **Pick your ships and a map.** The two pilots face off on two halves of the screen, like the split screen itself, with "vs" between them. Each half shows its name and keys ("Player 1 · WASD", "Computer pilot · flies itself", "Your friend · picks a ship when they open your link"), a large ship, ‹ › arrows to change the ship design, and the colours. Below that comes the chosen map: its name, its type (Duel, Creatures, Race, Co-op, Practice) and its full description (room for three lines, so the page doesn't jump), then a row of map pictures you scroll sideways. The Launch button is bottom right.

Details:
- Esc goes back from screen 2 to screen 1, and from screen 1 back to the game if one is running. The back button on screen 2 is labelled with the chosen mode ("‹ 2 players").
- An invite link opens on screen 2 only, with no mode tiles, map row or back button: "Join online game".
- Motion: screen 1's tiles rise in a stagger (420 ms, 60 ms apart). Screen 2's halves slide in from their own sides (380 ms). The ease is `cubic-bezier(0.23, 1, 0.32, 1)`. Picking things on a screen doesn't animate. With reduced motion, these become plain fades.
- Copy: "Skins" is gone. A mode is a name plus one line about the opponent: "Against the computer", "Split screen", "Play a friend".

Rejected:
- **Briefing** (one column of numbered questions under a big map picture, with maps grouped by type). It was the clearest, but it read as a form and needed the most scrolling. The map types it introduced live on as the type tag.
- **Poster** (a full-screen "vs" poster with the controls in a narrow side panel). It was the most exciting, but the map art fought the ships for attention and the side panel was too tight for two players.
- **Old page** (one scrolling page with players, skins and maps all at the same weight). Too much at once and no sense of the match ahead. Map descriptions were cut off at two lines.
