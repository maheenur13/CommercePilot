import { TEST_DATABASE_URL } from './global-setup.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.ADMIN_API_KEY = 'test-admin-key-0123456789';
process.env.OPENROUTER_API_KEY = '';
// The import e2e serves CSVs from this loopback port; only this exact host:port is exempt from SSRF checks.
process.env.IMPORT_ALLOWED_HOSTS = '127.0.0.1:47123';
