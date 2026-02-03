//********************************************************************
//
// ReviewWeekUsageDto Class
//
// Represents how many weekly review slots a user has used and how many
// remain out of the total weekly allocation (3). Used in review summary
// responses.
//
// Return Value
// ------------
// None (NestJS DTO class)
//
// Value Parameters
// ----------------
// used       number    Number of reviews used this week
// remaining  number    Number of reviews remaining this week
//
// Reference Parameters
// --------------------
// None
//
// Local Variables
// ---------------
// None
//
//*******************************************************************

export class ReviewWeekUsageDto {
  used: number;
  remaining: number;

  constructor(used: number, remaining: number) {
    this.used = used;
    this.remaining = remaining;
  }
}
