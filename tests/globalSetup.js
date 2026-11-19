// Fix the time zone so day-boundary logic is deterministic in every environment.
module.exports = async () => {
  process.env.TZ = 'Asia/Tokyo';
};
