import { readFileSync, writeFileSync, PathOrFileDescriptor } from "fs";
import { fetch } from "undici";
import CrowdinApiClient, { LanguagesModel } from "@crowdin/crowdin-api-client";

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url);
  const json = await res.json();
  return json;
}

class CrowdinProjectLanguages {
  sourceLanguage: LanguagesModel.Language;
  targetLanguages: LanguagesModel.Language[];

  constructor(sourceLanguage: LanguagesModel.Language, targetLanguages: LanguagesModel.Language[]) {
    this.sourceLanguage = sourceLanguage;
    this.targetLanguages = targetLanguages.sort((a, b) => a.locale.localeCompare(b.locale));
  }

  static async fromProjectId(projectId: number): Promise<CrowdinProjectLanguages> {
    const { projectsGroupsApi, languagesApi } = new CrowdinApiClient({
      token: process.env.CROWDIN_TOKEN!,
    });
    const { data: project } = await projectsGroupsApi.getProject(projectId);
    const { data: sourceLanguage } = await languagesApi.getLanguage(project.sourceLanguageId);
    return new CrowdinProjectLanguages(sourceLanguage, project.targetLanguages);
  }

  static async minecraft(): Promise<CrowdinProjectLanguages> {
    return CrowdinProjectLanguages.fromProjectId(3579);
  }

  matchMinecraftLanguageId(minecraftLanguageId: string): LanguagesModel.Language {
    if (minecraftLanguageId == "en_us") {
      return this.sourceLanguage;
    }

    for (const crowdinLanguage of this.targetLanguages) {
      const crowdinLanguageIds = [
        crowdinLanguage.id,
        crowdinLanguage.name,
        crowdinLanguage.editorCode,
        crowdinLanguage.twoLettersCode,
        crowdinLanguage.threeLettersCode,
        crowdinLanguage.locale,
        crowdinLanguage.id.toLowerCase().replaceAll("-", "_"),
        crowdinLanguage.locale.toLowerCase().replaceAll("-", "_"),
      ];
      if (crowdinLanguageIds.includes(minecraftLanguageId)) {
        return crowdinLanguage;
      }
    }

    throw Error(`can't match ${minecraftLanguageId}`);
  }
}

interface MinecraftLanguage {
  crowdinLocale: string;
  crowdinName: string;
  crowdinId: string;
  minecraftId: string | null;
}

class MinecraftLanguages {
  languages: MinecraftLanguage[];

  constructor(languages: MinecraftLanguage[]) {
    this.languages = languages;
  }

  static async init(): Promise<MinecraftLanguages> {
    const languages = [];
    const crowdinLanguages = await CrowdinProjectLanguages.minecraft();

    for (const minecraftLanguageId of await MinecraftLanguages.minecraftIds()) {
      const crowdinLanguage = crowdinLanguages.matchMinecraftLanguageId(minecraftLanguageId);
      languages.push({
        crowdinLocale: crowdinLanguage.locale,
        crowdinName: crowdinLanguage.name,
        crowdinId: crowdinLanguage.id,
        minecraftId: minecraftLanguageId,
      });
    }
    for (const crowdinLanguage of crowdinLanguages.targetLanguages) {
      if (!languages.some((language) => language.crowdinId == crowdinLanguage.id)) {
        languages.push({
          crowdinLocale: crowdinLanguage.locale,
          crowdinName: crowdinLanguage.name,
          crowdinId: crowdinLanguage.id,
          minecraftId: null,
        });
      }
    }

    return new MinecraftLanguages(languages);
  }

  static async minecraftIds(): Promise<string[]> {
    const versionManifest = await fetchJson(
      "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json"
    );
    const latestVersion = versionManifest.versions[0];
    const versionJson = await fetchJson(latestVersion.url);
    const assetIndex = await fetchJson(versionJson.assetIndex.url);

    const ids = [];
    for (const assetName in assetIndex.objects) {
      if (assetName.startsWith("minecraft/lang/") && assetName.endsWith(".json")) {
        const languageId = assetName.replace("minecraft/lang/", "").replace(".json", "");
        if (languageId != "en_us") {
          ids.push(languageId);
        }
      }
    }
    ids.sort((a, b) => a.localeCompare(b));

    return ["en_us"].concat(ids);
  }

  saveJson(filename: PathOrFileDescriptor = "minecraftLanguages.json") {
    writeFileSync(filename, JSON.stringify(this.languages, null, 2));
  }

  updateReadme(filename: PathOrFileDescriptor = "README.md") {
    const separator = "## Data";
    let readme = readFileSync(filename, { encoding: "utf-8" });
    readme = readme.split(separator)[0];
    readme += `${separator}\n\n`;
    readme += `Last updated ${new Date().toISOString()}\n\n`;
    readme += `| Crowdin Locale | Crowdin Name | Crowdin ID | Minecraft ID |\n`;
    readme += `|----------------|--------------|------------|--------------|\n`;
    for (const language of this.languages) {
      readme += `| ${language.crowdinLocale} `;
      readme += `| ${language.crowdinName} `;
      readme += `| ${language.crowdinId} `;
      if (language.minecraftId) {
        readme += `| ${language.minecraftId} `;
      } else {
        readme += `| _empty_ `;
      }
      readme += `|\n`;
    }
    writeFileSync(filename, readme);
  }
}

const main = async () => {
  const minecraftLanguages = await MinecraftLanguages.init();
  minecraftLanguages.saveJson();
  minecraftLanguages.updateReadme();
};

main();
