const { Plugin, PluginSettingTab, Setting, normalizePath, TFile, TFolder, Notice } = require('obsidian');

function extractYouTubeId(url) {
  const regex = /(?:youtube\.com\/.*v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

function getNotesFolderPath(sourcePath) {
  // Parent-Ordner des Dokuments + /video-notes
  const parent = sourcePath.contains("/") ? sourcePath.substring(0, sourcePath.lastIndexOf("/")) : "";
  return normalizePath(parent ? `${parent}/video-notes` : "video-notes");
}

function getNoteFileName(title) {
  // Dateiname: Titel (max. 100 Zeichen, keine Sonderzeichen außer Leerzeichen und Bindestrich)
  let safeTitle = title.replace(/[^a-zA-Z0-9äöüÄÖÜß \-]/g, "").replace(/\s+/g, " ").trim().substring(0, 100);
  return `${safeTitle}.md`;
}

module.exports = class YtGridPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    this.addSettingTab(new YtGridSettingTab(this.app, this));

    this.registerMarkdownCodeBlockProcessor("youtubeGrid", async (source, el, ctx) => {
      const urls = source
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

      // Dynamische Spaltenanzahl: 1–4, je nach Anzahl Videos
      let columns = 1;
      if (urls.length === 2) columns = 2;
      else if (urls.length === 3) columns = 3;
      else if (urls.length === 4) columns = 2;
      else if (urls.length === 5) columns = 3;
      else if (urls.length === 6) columns = 3;
      else if (urls.length >= 7) columns = 4;

      const grid = document.createElement("div");
      grid.style.display = "grid";
      grid.style.gridTemplateColumns = `repeat(${columns}, minmax(220px, 1fr))`;
      grid.style.gap = "1rem";
      grid.style.margin = "1em 0";

      for (const url of urls) {
        const videoId = extractYouTubeId(url);
        if (!videoId) continue;

        const thumbUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
        let title = "";

        if (this.settings.apiKey) {
          try {
            const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${this.settings.apiKey}`;
            const resp = await fetch(apiUrl);
            const data = await resp.json();
            title = data.items?.[0]?.snippet?.title || "";
          } catch (e) {
            title = "";
          }
        }

        const card = document.createElement("div");
        card.style.background = "#181818";
        card.style.borderRadius = "8px";
        card.style.overflow = "hidden";
        card.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
        card.style.cursor = "pointer";
        card.style.transition = "transform 0.2s";
        card.onmouseover = () => card.style.transform = "scale(1.03)";
        card.onmouseout = () => card.style.transform = "scale(1)";

        // Notiz-Button (Icon, SVG wie gewünscht, mit kontrastreichem Hintergrund)
        const noteBtn = document.createElement("button");
        noteBtn.title = "Notiz zum Video anlegen/öffnen";
        noteBtn.style.background = "rgba(255,255,255,0.85)";
        noteBtn.style.border = "none";
        noteBtn.style.position = "absolute";
        noteBtn.style.top = "8px";
        noteBtn.style.left = "8px";
        noteBtn.style.cursor = "pointer";
        noteBtn.style.zIndex = "2";
        noteBtn.style.padding = "2px";
        noteBtn.style.margin = "0";
        noteBtn.style.width = "32px";
        noteBtn.style.height = "32px";
        noteBtn.style.borderRadius = "8px";
        noteBtn.style.boxShadow = "0 2px 8px rgba(0,0,0,0.18)";
        noteBtn.innerHTML = `
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#222" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-edit"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"></path></svg>
`;

        // Container für das Bild und Icon
        const imgContainer = document.createElement("div");
        imgContainer.style.position = "relative";

        imgContainer.appendChild(noteBtn);

        const link = document.createElement("a");
        link.href = `https://www.youtube.com/watch?v=${videoId}`;
        link.target = "_blank";
        link.style.display = "block";
        link.style.textDecoration = "none";
        link.style.color = "#fff";

        const img = document.createElement("img");
        img.src = thumbUrl;
        img.alt = "YouTube Thumbnail";
        img.style.width = "100%";
        img.style.display = "block";
        img.style.margin = "0";
        img.style.padding = "0";
        img.style.border = "none";

        imgContainer.appendChild(img);
        link.appendChild(imgContainer);

        if (title) {
          const titleDiv = document.createElement("div");
          titleDiv.textContent = title;
          titleDiv.style.padding = "0.2em 0.5em";
          titleDiv.style.fontWeight = "bold";
          titleDiv.style.fontSize = "1em";
          titleDiv.style.background = "#222";
          titleDiv.style.borderBottomLeftRadius = "8px";
          titleDiv.style.borderBottomRightRadius = "8px";
          titleDiv.style.margin = "0";
          titleDiv.style.lineHeight = "1.2";
          titleDiv.style.borderTop = "none";
          link.appendChild(titleDiv);
        }

        card.appendChild(link);
        grid.appendChild(card);

        // Notiz-Logik
        noteBtn.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();

          if (!title) {
            new Notice("Kein Titel verfügbar. Bitte API-Key prüfen.");
            return;
          }

          const notesFolder = getNotesFolderPath(ctx.sourcePath);
          const noteFileName = getNoteFileName(title);
          const notePath = normalizePath(`${notesFolder}/${noteFileName}`);

          // Prüfe, ob Notiz existiert
          let noteFile = this.app.vault.getAbstractFileByPath(notePath);
          if (!noteFile) {
            // Ordner anlegen, falls nicht vorhanden
            let folder = this.app.vault.getAbstractFileByPath(notesFolder);
            if (!folder) {
              await this.app.vault.createFolder(notesFolder);
            }
            // Notiz anlegen: nur das Video-Embed
            const noteContent = `![](https://www.youtube.com/watch?v=${videoId})\n`;
            noteFile = await this.app.vault.create(notePath, noteContent);

            new Notice("Notiz wurde angelegt.");
          } else {
            new Notice("Notiz existiert bereits.");
          }

          // Notiz öffnen
          if (noteFile) {
            this.app.workspace.openLinkText(notePath, ctx.sourcePath, true);
          }
        };
      }

      el.appendChild(grid);
    });
  }

  async loadSettings() {
    this.settings = Object.assign({}, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
};

class YtGridSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "ytgrid Einstellungen" });

    new Setting(containerEl)
      .setName("YouTube Data API Key")
      .setDesc("Optional: Trage hier deinen YouTube Data API v3 Key ein, um die Videotitel anzuzeigen.")
      .addText(text => text
        .setPlaceholder("API Key")
        .setValue(this.plugin.settings.apiKey || "")
        .onChange(async (value) => {
          this.plugin.settings.apiKey = value.trim();
          await this.plugin.saveSettings();
        }));
  }
}