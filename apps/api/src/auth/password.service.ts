import { Injectable, OnModuleInit } from "@nestjs/common";
import * as argon2 from "argon2";

const dummyPassword = "internal-authentication-dummy-password";

@Injectable()
export class PasswordService implements OnModuleInit {
  private dummyHash?: string;

  async onModuleInit() {
    this.dummyHash = await this.hash(dummyPassword);
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
    });
  }

  verify(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }

  async verifyAgainstDummy(password: string): Promise<boolean> {
    const hash = this.dummyHash ?? (await this.hash(dummyPassword));
    this.dummyHash = hash;

    return this.verify(hash, password);
  }
}
