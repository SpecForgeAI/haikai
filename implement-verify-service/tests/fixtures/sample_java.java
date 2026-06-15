package com.example.service;

import java.util.List;
import java.util.ArrayList;
import java.util.Collections;
import com.example.db.Database;
import com.example.model.*;

public class UserService {
    private Database db;
    private List<String> cache;

    public UserService(Database database) {
        this.db = database;
        this.cache = new ArrayList<>();
    }

    public void processUsers() {
        List<String> users = db.findAll();
        Collections.sort(users);
        for (String user : users) {
            handleUser(user);
        }
    }

    private void handleUser(String name) {
        UserValidator validator = new UserValidator();
        validator.validate(name);
        db.save(name);
    }

    public static UserService create(Database db) {
        return new UserService(db);
    }
}

interface Repository<T> {
    T findById(int id);
    List<T> findAll();
    void save(T entity);
}

enum Status {
    ACTIVE, INACTIVE;

    public boolean isActive() {
        return this == ACTIVE;
    }
}
