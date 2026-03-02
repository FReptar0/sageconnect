// tests/GetProviderByExternalId.test.js - Test getProviderByExternalId utility
// Usage: node tests/GetProviderByExternalId.test.js EXTERNAL_ID
//        node tests/GetProviderByExternalId.test.js EXTERNAL_ID --index=1

const { getProviderByExternalId } = require('../src/utils/GetProviders');

const args = process.argv.slice(2);
const externalId = args.find(a => !a.startsWith('--'));
const indexArg = args.find(a => a.startsWith('--index='));
const index = indexArg ? parseInt(indexArg.split('=')[1], 10) : 0;

if (!externalId) {
    console.log('Usage: node tests/GetProviderByExternalId.test.js <EXTERNAL_ID> [--index=N]');
    console.log('Example: node tests/GetProviderByExternalId.test.js 534-0039');
    process.exit(1);
}

async function main() {
    console.log(`Buscando proveedor con externalId: ${externalId} (tenant index: ${index})\n`);

    const provider = await getProviderByExternalId(index, externalId);

    if (!provider) {
        console.log('Resultado: No se encontró proveedor único.');
        process.exit(0);
    }

    console.log('Resultado:');
    console.log(`  id:          ${provider.id}`);
    console.log(`  external_id: ${provider.external_id || '(vacío)'}`);
    console.log(`  name:        ${provider.name || provider.business_name || '(vacío)'}`);
    console.log(`  rfc:         ${provider.rfc || '(vacío)'}`);
    console.log(`  status:      ${provider.status || '(vacío)'}`);

    process.exit(0);
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
