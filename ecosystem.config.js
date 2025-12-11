module.exports = {
  apps: [
    {
      name: "tma-backend",
      script: "./index.js",
      watch: false,
      env: {
        PORT: 3000,
        BOT_TOKEN: process.env.BOT_TOKEN,
        ADMIN_CHAT_IDS: process.env.ADMIN_CHAT_IDS,
        GITHUB_REPO: process.env.GITHUB_REPO,
        GITHUB_TOKEN: process.env.GITHUB_TOKEN
      }
    }
  ]
}
