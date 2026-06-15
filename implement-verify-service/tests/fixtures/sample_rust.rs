use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::fs::File;

pub struct Database {
    connections: HashMap<String, Connection>,
    max_pool: usize,
}

struct Connection {
    host: String,
    port: u16,
}

impl Database {
    pub fn new(max_pool: usize) -> Self {
        Database {
            connections: HashMap::new(),
            max_pool,
        }
    }

    pub fn connect(&mut self, name: &str, host: &str, port: u16) {
        let conn = Connection::new(host, port);
        self.connections.insert(name.to_string(), conn);
        println!("Connected: {}", name);
    }

    pub fn query(&self, name: &str, sql: &str) -> Vec<String> {
        if let Some(conn) = self.connections.get(name) {
            conn.execute(sql)
        } else {
            vec![]
        }
    }
}

impl Connection {
    fn new(host: &str, port: u16) -> Self {
        Connection {
            host: host.to_string(),
            port,
        }
    }

    fn execute(&self, sql: &str) -> Vec<String> {
        println!("Executing on {}:{}: {}", self.host, self.port, sql);
        Vec::new()
    }
}

trait Repository<T> {
    fn find_by_id(&self, id: u64) -> Option<T>;
    fn save(&mut self, entity: T);
}

fn process_data(db: &Database) {
    let results = db.query("main", "SELECT * FROM users");
    for r in &results {
        println!("{}", r);
    }
}

fn main() {
    let mut db = Database::new(10);
    db.connect("main", "localhost", 5432);
    process_data(&db);
}
