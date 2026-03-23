module.exports = {
    transform: {
        '^.+\\.js$': 'babel-jest'
    },
    testMatch: ['<rootDir>/tests/**/*.test.js'],
    testPathIgnorePatterns: [
        'tests/EnhancedPaymentSync.test.js',
        'tests/GetProviderByExternalId.test.js',
        'tests/ResolveUuidByFolio.test.js'
    ]
};