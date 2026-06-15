// Sample TypeScript file for tree-sitter extraction tests
import { Database } from './database';
import { Logger, LogLevel } from '../utils/logger';
import * as path from 'path';
import express from 'express';

interface UserRepository {
    findById(id: string): Promise<User>;
    save(user: User): Promise<void>;
}

class User {
    constructor(
        public id: string,
        public name: string,
        public email: string
    ) {}

    getDisplayName(): string {
        return this.name.toUpperCase();
    }
}

class UserService implements UserRepository {
    private db: Database;
    private logger: Logger;

    constructor(db: Database, logger: Logger) {
        this.db = db;
        this.logger = logger;
    }

    async findById(id: string): Promise<User> {
        this.logger.info(`Finding user ${id}`);
        const result = await this.db.query('SELECT * FROM users WHERE id = $1', [id]);
        return new User(result.id, result.name, result.email);
    }

    async save(user: User): Promise<void> {
        this.logger.info(`Saving user ${user.id}`);
        await this.db.execute('INSERT INTO users VALUES ($1, $2, $3)', [
            user.id, user.name, user.email
        ]);
    }

    async findOrCreate(id: string, name: string): Promise<User> {
        const existing = await this.findById(id);
        if (existing) {
            return existing;
        }
        const user = new User(id, name, `${name}@example.com`);
        await this.save(user);
        return user;
    }
}

// Optional chaining
function getOptionalData(service?: UserService) {
    const name = service?.findById('1');
    const result = service?.db?.query('test');
    return name;
}

// Module-level calls
const app = express();
const defaultLogger = new Logger(LogLevel.INFO);
console.log('Starting application');

export { UserService, User };
export default UserService;
