#include <iostream>
#include <vector>
#include <memory>
#include "sample_cpp.hpp"

namespace myapp {

Database::Database(const std::string& conn) : connection_(conn) {}

void Database::connect() {
    std::cout << "Connecting to " << connection_ << std::endl;
}

std::vector<std::string> Database::query(const std::string& sql) {
    std::cout << "Query: " << sql << std::endl;
    return {};
}

UserService::UserService(std::shared_ptr<Database> db) : db_(db) {}

void UserService::processUsers() {
    auto users = db_->query("SELECT * FROM users");
    std::sort(users.begin(), users.end());
    for (const auto& user : users) {
        handleUser(user);
    }
}

void UserService::handleUser(const std::string& name) {
    auto validator = std::make_shared<UserValidator>();
    validator->validate(name);
    db_->save(name);
}

} // namespace myapp

int main(int argc, char** argv) {
    auto db = std::make_shared<myapp::Database>("localhost:5432");
    db->connect();

    myapp::UserService service(db);
    service.processUsers();

    auto ptr = new myapp::UserValidator();
    delete ptr;

    return 0;
}
