module.exports = {
  apps: [
    {
      name: 'cloneai',
      script: 'node',
      args: '.next/standalone/server.js',
      cwd: '/var/www/cloneai',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOSTNAME: '0.0.0.0',
      },
    },
  ],
}
