#include <stdio.h>
#include <stdlib.h>
#include "mylib.h"

typedef struct {
    int id;
    char name[64];
} User;

typedef struct {
    void (*process)(User *user);
    int (*validate)(const char *name);
} Handler;

void print_user(User *user) {
    printf("User: %s (id=%d)\n", user->name, user->id);
}

int validate_name(const char *name) {
    if (name == NULL) return 0;
    return strlen(name) > 0;
}

User *create_user(int id, const char *name) {
    User *user = malloc(sizeof(User));
    user->id = id;
    snprintf(user->name, sizeof(user->name), "%s", name);
    return user;
}

void process_users(Handler *handler, User **users, int count) {
    for (int i = 0; i < count; i++) {
        if (handler->validate(users[i]->name)) {
            handler->process(users[i]);
        }
    }
    free(users);
}

int main(int argc, char **argv) {
    User *user = create_user(1, "Alice");
    print_user(user);

    Handler handler = { .process = print_user, .validate = validate_name };
    handler.process(user);

    free(user);
    return 0;
}
