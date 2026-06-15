
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class UserService {
  constructor(private http: HttpClient) {}

  login(req: any) { return this.http.post('/api/users/login', req); }
  register(req: any) { return this.http.post('/api/users', req); }
  getCurrent() { return this.http.get('/api/user'); }
  updateUser(req: any) { return this.http.put('/api/user', req); }

  // Genuine business
  authenticateSession(token: string): boolean { return token.length > 0; }
}
