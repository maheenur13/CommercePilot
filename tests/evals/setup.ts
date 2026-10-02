import 'dotenv/config'; // picks up OPENROUTER_API_KEY / LLM_MODEL from the shell or env file

import { TEST_DATABASE_URL } from '../e2e/global-setup.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.ADMIN_API_KEY = 'test-admin-key-0123456789';
process.env.IMPORT_ALLOWED_HOSTS = '127.0.0.1:47124'; // local CSV server in import.eval.spec.ts
