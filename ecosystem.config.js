module.exports = {
  apps: [
    {
      name: "tma-backend",
      script: "index.js",     
      env_file: ".env",
      env: {
        NODE_ENV: "production",
        PORT: 3000
      }
    }
  ]
}
