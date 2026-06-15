
import { Controller, Get, Post, Put, Body, Param } from '@nestjs/common';

@Controller('users')
export class UserController {
  @Post('login')
  login(@Body('user') data: LoginDto): Promise<UserDto> {
    return Promise.resolve({} as any);
  }

  @Post()
  register(@Body('user') data: CreateUserDto): Promise<UserDto> {
    return Promise.resolve({} as any);
  }

  @Get('current')
  current(): Promise<UserDto> {
    return Promise.resolve({} as any);
  }

  @Put()
  update(@Body('user') data: UpdateUserDto): Promise<UserDto> {
    return Promise.resolve({} as any);
  }
}

export class LoginDto { email: string; password: string; }
export class CreateUserDto { username: string; email: string; password: string; }
export class UpdateUserDto { bio?: string; image?: string; }
export class UserDto { username: string; email: string; token: string; }
