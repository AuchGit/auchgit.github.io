# auchgit.github.io

Die Website zu den Spielen, Tools und dem AuchLauncher: https://auchgit.github.io

Astro + Tailwind, statisch auf GitHub Pages. Beim Bauen holt
`scripts/fetch-data.mjs` den Spielekatalog des Launchers und die Releases aller
Projekte von GitHub; der Workflow baut stündlich neu, neue Versionen erscheinen
also von selbst.

```bash
npm install
npm run dev      # Daten vorher mit `npm run data` holen
npm run build
```

- Spiele: kommen aus `AuchGit/AuchLauncher` (`public/catalog/games.json`)
- Tools und Texte: `site.config.json`
- Bilder des Launchers: `public/img/`
