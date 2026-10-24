import { REST, Routes } from "discord.js";
import { commands } from "./commands/index.js";
import { discordClientId, discordGuildId, discordToken } from "./config.js";

// スラッシュコマンドを、テストサーバーにだけ登録する（すぐ反映される）
// コマンドを足したり変えたりしたら、npm run deploy をもう一度実行する
const body = commands.map((command) => command.data.toJSON());

await new REST()
  .setToken(discordToken)
  .put(Routes.applicationGuildCommands(discordClientId, discordGuildId), { body });

console.log(`${body.length} 個のコマンドを登録しました: ${body.map((c) => `/${c.name}`).join(" ")}`);
