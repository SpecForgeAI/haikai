
export interface UserDto {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
}

export type CreateUserRequest = {
  firstName: string;
  lastName: string;
};
