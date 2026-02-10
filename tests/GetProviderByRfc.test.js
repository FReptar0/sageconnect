// tests/GetProviderByRfc.test.js - Test getProviderByRfc utility
// Usage: node tests/GetProviderByRfc.test.js RFC_VALUE
//        node tests/GetProviderByRfc.test.js RFC_VALUE --index=1

const { getProviderByRfc } = require('../src/utils/GetProviders');

const args = process.argv.slice(2);
const rfc = args.find(a => !a.startsWith('--'));
const indexArg = args.find(a => a.startsWith('--index='));
const index = indexArg ? parseInt(indexArg.split('=')[1], 10) : 0;

if (!rfc) {
    console.log('Usage: node tests/GetProviderByRfc.test.js <RFC> [--index=N]');
    console.log('Example: node tests/GetProviderByRfc.test.js XAXX010101000');
    process.exit(1);
}

async function main() {
    console.log(`Buscando proveedor con RFC: ${rfc} (tenant index: ${index})\n`);

    const provider = await getProviderByRfc(index, rfc);

    if (!provider) {
        console.log('Resultado: No se encontró proveedor.');
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
