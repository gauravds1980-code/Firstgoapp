// Dynamic config: takes app.json and applies the product name from brand.json (single source of truth).
const brand = require('./brand.json');

module.exports = ({ config }) => ({ ...config, name: brand.appName });
