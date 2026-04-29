// src/utils/PortalClient.js (NEW -- Phase 19 ROOT-01 / D-01)
const axios = require('axios');
const config = require('../config');

/**
 * Cliente HTTP centralizado para el portal de proveedores Focaltec.
 * Aplica un timeout default desde config.portal.httpTimeoutMs (env PORTAL_HTTP_TIMEOUT_MS, default 30s).
 *
 * Razon de existir (ROOT-01 / D-01): bajo always-on, axios sin timeout = lock huerfano cada cron tick.
 * Cliente compartido elimina la posibilidad de "olvide poner timeout en el call site nuevo".
 *
 * Match exacto al patron de src/services/LicenseValidator.js:49 (licenseClient).
 * Diferencia intencional: usa config.portal.httpTimeoutMs en lugar de constante hardcoded;
 * el LicenseValidator tiene timeout 10s dedicado, el portal del cliente acepta 30s default.
 */
const portalClient = axios.create({
    timeout: config.portal.httpTimeoutMs,
    headers: { 'Accept': 'application/json' },
});

module.exports = portalClient;
