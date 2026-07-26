export type JwtPayload = {
  sub: string;
  type: "access";
  jti?: string;
};
