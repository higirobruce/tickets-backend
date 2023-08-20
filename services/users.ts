import {userModel } from "../models/users";
import crypto from 'crypto';

let SALT = '762f021e88bdfdc80f8e174edbdfaf65';

// export const generateUserNumber = async () => {
//     // Get the last saved document
//     const lastDocument = await userModel.findOne().sort({ number: -1 });
//     // Generate a new 10-digit number, starting from 1000000000 and incrementing by 1
//     let newNumber = 1000000;
//     if (lastDocument && lastDocument.number) {
//         newNumber = lastDocument.number + 1;
//     }

//     // Return the new number
//     return newNumber;
// }

export const generatePassword = (
  length = 20,
  wishlist = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz~!@-#$'
) =>
  Array.from(crypto.randomFillSync(new Uint32Array(length)))
    .map((x) => wishlist[x % wishlist.length])
    .join('')


export const hashPassword = (password: any) => {

    // Creating a unique salt for a particular user 
    
    // Hashing user's salt and password with 1000 iterations, 

    let hash = crypto.pbkdf2Sync(password, SALT,
        1000, 64, `sha512`).toString(`hex`);

    return hash.toString()
};


export const validPassword = (password: any, savedPassword:any) =>{
    var hash = crypto.pbkdf2Sync(password,
        SALT, 1000, 64, `sha512`).toString(`hex`);
    return savedPassword === hash;
};