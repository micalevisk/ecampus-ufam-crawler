#!/usr/bin/env node

require('dotenv/config');

if (require.main === module) {
  const credentials = {
    login: process.env.ECAMPUS_LOGIN,
    password: process.env.ECAMPUS_PASSWORD,
  };
  // Clear sensititve env. vars. to prevent bad usage from external dependencies.
  process.env.ECAMPUS_LOGIN=undefined;
  process.env.ECAMPUS_PASSWORD=undefined;

  require('./notas-ecampus')(credentials);
}
