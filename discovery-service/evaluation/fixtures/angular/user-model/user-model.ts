
export interface User {
  id: number;
  username: string;
  email: string;
  token: string;
  bio: string | null;
  image: string | null;
}

export interface Profile {
  username: string;
  bio: string | null;
  image: string | null;
  following: boolean;
}
