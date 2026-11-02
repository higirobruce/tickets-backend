"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const winston = require('winston');
exports.logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
    // winston.format.label({ label: 'right meow!' }),
    winston.format.timestamp(), winston.format.prettyPrint()),
    defaultMeta: { service: 'user-service' },
    transports: [
        //
        // - Write all logs with importance level of `error` or less to `error.log`
        // - Write all logs with importance level of `info` or less to `combined.log`
        //
        new winston.transports.File({ filename: './dist/logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: './dist/logs/combined.log' }),
    ],
});
