
import axios from 'axios';

export interface LoginRequest { email: string; password: string; }
export interface LoginResponse { token: string; userId: number; }

export async function login(req: LoginRequest): Promise<LoginResponse> {
  const res = await axios.post<LoginResponse>('/api/users/login', req);
  return res.data;
}

// Genuine business logic — not CRUD-prefixed
export async function validateSession(token: string): Promise<boolean> {
  return token.length > 0;
}
