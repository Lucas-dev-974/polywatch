import { isAddress } from 'ethers';
import { z } from 'zod';

/** Valid 0x Ethereum address (checksum verified when mixed-case). */
export const ethAddressSchema = z
  .string()
  .refine((v) => isAddress(v), { message: 'invalid_address' });

/** Valid 0x address or empty string (used for "leave unchanged" fields). */
export const emptyableEthAddressSchema = z
  .string()
  .refine((v) => v === '' || isAddress(v), { message: 'invalid_address' });
