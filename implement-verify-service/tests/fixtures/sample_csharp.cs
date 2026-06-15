using System;
using System.Collections.Generic;
using System.Linq;
using static System.Console;

namespace MyApp.Services
{
    public class UserService
    {
        private Database _db;
        private readonly List<string> _cache;

        public UserService(Database database)
        {
            _db = database;
            _cache = new List<string>();
        }

        public void ProcessUsers()
        {
            var users = _db.FindAll();
            users.Sort();
            foreach (var user in users)
            {
                HandleUser(user);
            }
        }

        private void HandleUser(string name)
        {
            var validator = new UserValidator();
            validator.Validate(name);
            _db.Save(name);
            WriteLine(name);
        }

        public static UserService Create(Database db)
        {
            return new UserService(db);
        }
    }

    public struct Point
    {
        public int X { get; set; }
        public int Y { get; set; }

        public double DistanceTo(Point other)
        {
            return Math.Sqrt(Math.Pow(X - other.X, 2) + Math.Pow(Y - other.Y, 2));
        }
    }

    public interface IRepository<T>
    {
        T FindById(int id);
        List<T> FindAll();
        void Save(T entity);
    }
}
