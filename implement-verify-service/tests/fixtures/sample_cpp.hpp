#ifndef SAMPLE_CPP_HPP
#define SAMPLE_CPP_HPP

#include <string>
#include <vector>
#include <memory>

namespace myapp {

class Database {
public:
    explicit Database(const std::string& conn);
    void connect();
    std::vector<std::string> query(const std::string& sql);
    void save(const std::string& data);

private:
    std::string connection_;
};

class UserValidator {
public:
    bool validate(const std::string& name);
};

class UserService {
public:
    explicit UserService(std::shared_ptr<Database> db);
    void processUsers();

private:
    void handleUser(const std::string& name);
    std::shared_ptr<Database> db_;
};

} // namespace myapp

#endif // SAMPLE_CPP_HPP
