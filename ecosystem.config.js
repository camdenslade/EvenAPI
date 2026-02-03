module.exports = {
  apps: [
    {
      name: 'even-backend',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'alpha',
      },
    },
  ],
};
