#ifndef MYLIB_H
#define MYLIB_H

typedef struct Database {
    char *connection_string;
    int port;
} Database;

Database *db_connect(const char *conn_str);
void db_disconnect(Database *db);
int db_query(Database *db, const char *sql);

#endif /* MYLIB_H */
