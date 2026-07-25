export interface PlainApiClobCredentials {
  apiKey: string;
  secret: string;
  passphrase: string;
  signerPrivateKey: string;
}

export interface InternalClobCredentialsResponse {
  walletAddress: string;
  funderAddress: string | null;
  apiKey: string | null;
  secret: string | null;
  passphrase: string | null;
  signerPrivateKey: string | null;
  signatureType: number | null;
}
