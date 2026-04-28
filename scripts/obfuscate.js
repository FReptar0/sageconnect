#!/usr/bin/env node

/**
 * Script de ofuscación para SageConnect
 *
 * Copia el proyecto a una carpeta `dist/` y ofusca todos los archivos .js
 * dentro de `src/`. Los archivos de configuración, public/, tests/, etc.
 * se copian sin modificar.
 *
 * Uso:
 *   node scripts/obfuscate.js              → genera en dist/
 *   node scripts/obfuscate.js --push       → genera en dist/ y pushea al repo destino
 */

const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

// ─── Configuración ──────────────────────────────────────────────────
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

// Repositorio destino (cambiar por tu URL real)
const TARGET_REPO = process.env.OBFUSCATED_REPO_URL || 'https://github.com/FReptar0/sageconnect-dist.git';

// Carpetas/archivos a copiar tal cual (sin ofuscar)
const COPY_AS_IS = [
    'package.json',
    'package-lock.json',
    'babel.config.js',
    'jest.config.js',
    'README.md',
    'LICENSE.md',
    'CODE_OF_CONDUCT.md',
    'CONTRIBUTING.md',
    'EULA.md',
    'SECURITY.md',
    'public',
    'scripts/install-service.ps1',
    '.env.example',
    '.env.credentials.example',
    'scripts/migrate-env.js',
    'scripts/Rotate-SageConnectLogs.ps1',
];

// Carpetas cuyo JS se ofuscará
const OBFUSCATE_DIRS = ['src'];

// Archivos/carpetas excluidos de la copia
const EXCLUDED = [
    'node_modules',
    '.git',
    '.github',
    'dist',
    'logs',
    'reports',
    'tests',
    'coverage',
    '.env',
    '.env.local',
    '.DS_Store',
    'scripts/obfuscate.js',  // No incluir este script en la distribución
];

// Opciones de javascript-obfuscator (nivel alto)
const OBFUSCATION_OPTIONS = {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.75,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.4,
    debugProtection: false,               // true puede causar problemas en producción
    disableConsoleOutput: false,           // mantener console.log funcional
    identifierNamesGenerator: 'hexadecimal',
    log: false,
    numbersToExpressions: true,
    renameGlobals: false,                  // false para evitar romper require/module.exports
    selfDefending: false,                  // false para entornos server-side
    simplify: true,
    splitStrings: true,
    splitStringsChunkLength: 10,
    stringArray: true,
    stringArrayCallsTransform: true,
    stringArrayCallsTransformThreshold: 0.75,
    stringArrayEncoding: ['base64'],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 2,
    stringArrayWrappersChainedCalls: true,
    stringArrayWrappersParametersMaxCount: 4,
    stringArrayWrappersType: 'function',
    stringArrayThreshold: 0.75,
    transformObjectKeys: true,
    unicodeEscapeSequence: false,
    target: 'node',                        // Optimizado para Node.js
};

// ─── Utilidades ─────────────────────────────────────────────────────

function isExcluded(relativePath) {
    return EXCLUDED.some((ex) => {
        const normalized = relativePath.replace(/\\/g, '/');
        return normalized === ex || normalized.startsWith(ex + '/');
    });
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function copyFileSync(src, dest) {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
}

function copyDirSync(src, dest) {
    ensureDir(dest);
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        const relPath = path.relative(ROOT_DIR, srcPath);

        if (isExcluded(relPath)) continue;

        if (entry.isDirectory()) {
            copyDirSync(srcPath, destPath);
        } else {
            copyFileSync(srcPath, destPath);
        }
    }
}

function obfuscateFile(filePath) {
    const code = fs.readFileSync(filePath, 'utf8');
    try {
        const result = JavaScriptObfuscator.obfuscate(code, OBFUSCATION_OPTIONS);
        return result.getObfuscatedCode();
    } catch (err) {
        console.warn(`  ⚠ No se pudo ofuscar ${filePath}: ${err.message}`);
        return code; // devolver sin ofuscar si falla
    }
}

function processDirectory(srcDir, destDir) {
    ensureDir(destDir);
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);
        const relPath = path.relative(ROOT_DIR, srcPath);

        if (isExcluded(relPath)) continue;

        if (entry.isDirectory()) {
            processDirectory(srcPath, destPath);
        } else if (entry.name.endsWith('.js')) {
            console.log(`  🔒 Ofuscando: ${relPath}`);
            const obfuscated = obfuscateFile(srcPath);
            ensureDir(path.dirname(destPath));
            fs.writeFileSync(destPath, obfuscated, 'utf8');
        } else {
            copyFileSync(srcPath, destPath);
        }
    }
}

// ─── Ejecución principal ────────────────────────────────────────────

async function main() {
    const shouldPush = process.argv.includes('--push');

    console.log('╔══════════════════════════════════════════════╗');
    console.log('║     SageConnect — Obfuscation Build          ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log();

    // 1. Limpiar directorio dist
    console.log('🗑  Limpiando directorio dist/...');
    if (fs.existsSync(DIST_DIR)) {
        fs.rmSync(DIST_DIR, { recursive: true, force: true });
    }
    ensureDir(DIST_DIR);

    // 2. Copiar archivos/carpetas estáticos
    console.log('📋 Copiando archivos estáticos...');
    for (const item of COPY_AS_IS) {
        const srcPath = path.join(ROOT_DIR, item);
        const destPath = path.join(DIST_DIR, item);

        if (!fs.existsSync(srcPath)) {
            console.log(`  ⏭  Omitido (no existe): ${item}`);
            continue;
        }

        const stat = fs.statSync(srcPath);
        if (stat.isDirectory()) {
            copyDirSync(srcPath, destPath);
        } else {
            copyFileSync(srcPath, destPath);
        }
        console.log(`  ✅ ${item}`);
    }

    // 3. Ofuscar código fuente
    console.log();
    console.log('🔐 Ofuscando código fuente...');
    for (const dir of OBFUSCATE_DIRS) {
        const srcPath = path.join(ROOT_DIR, dir);
        const destPath = path.join(DIST_DIR, dir);

        if (!fs.existsSync(srcPath)) {
            console.log(`  ⏭  Omitido (no existe): ${dir}/`);
            continue;
        }

        processDirectory(srcPath, destPath);
    }

    // 4. Crear .gitignore para dist
    const distGitignore = [
        'node_modules/',
        '.env',
        '.env.local',
        '.env.*.local',
        'logs/',
        '*.log',
        '.DS_Store',
    ].join('\n');
    fs.writeFileSync(path.join(DIST_DIR, '.gitignore'), distGitignore, 'utf8');

    // 5. Modificar package.json en dist (quitar devDependencies y scripts innecesarios)
    const pkgPath = path.join(DIST_DIR, 'package.json');
    if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        delete pkg.devDependencies;
        // Mantener solo scripts de producción
        pkg.scripts = {
            start: pkg.scripts?.start || 'node src/index.js',
            'background-only': pkg.scripts?.['background-only'] || 'node src/background.js',
        };
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf8');
        console.log('  ✅ package.json limpiado para producción');
    }

    console.log();
    console.log('✅ Build ofuscado generado en dist/');

    // 6. Push al repositorio destino (opcional)
    if (shouldPush) {
        console.log();
        console.log(`🚀 Pusheando al repositorio: ${TARGET_REPO}`);

        const { execSync } = require('child_process');
        const opts = { cwd: DIST_DIR, stdio: 'inherit' };

        try {
            // Inicializar repo git en dist si no existe
            if (!fs.existsSync(path.join(DIST_DIR, '.git'))) {
                execSync('git init', opts);
                execSync(`git remote add origin ${TARGET_REPO}`, opts);
            }

            // Obtener la rama actual del repo original
            const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
                cwd: ROOT_DIR,
                encoding: 'utf8',
            }).trim();

            // Obtener el último commit message del repo original
            const commitMsg = execSync('git log -1 --pretty=%B', {
                cwd: ROOT_DIR,
                encoding: 'utf8',
            }).trim();

            execSync('git add -A', opts);
            execSync(
                `git commit -m "build(obfuscated): ${commitMsg}" --allow-empty`,
                opts
            );
            execSync(`git push -u origin HEAD:${currentBranch} --force`, opts);

            console.log('✅ Push completado exitosamente');
        } catch (err) {
            console.error('❌ Error al pushear:', err.message);
            console.log();
            console.log('Asegúrate de:');
            console.log(`  1. El repositorio ${TARGET_REPO} existe en GitHub`);
            console.log('  2. Tienes permisos de escritura');
            console.log('  3. Tu autenticación de Git está configurada');
            process.exit(1);
        }
    }

    console.log();
    console.log('🎉 ¡Proceso completado!');
}

main().catch((err) => {
    console.error('❌ Error fatal:', err);
    process.exit(1);
});
