// A minimal stand-in for the `pg` package's Pool/query interface, used
// only in tests so postgres-store.js's logic can be verified without a
// live database connection.

let queries = [];
let nextRows = [];

class Pool {
  constructor(config) {
    this.config = config;
  }

  async query(sql, params = []) {
    queries.push({ sql, params });

    if (sql.trim().startsWith('CREATE TABLE')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.trim().startsWith('INSERT')) {
      return { rows: nextRows, rowCount: nextRows.length };
    }
    if (sql.trim().startsWith('SELECT')) {
      return { rows: nextRows, rowCount: nextRows.length };
    }
    if (sql.trim().startsWith('DELETE')) {
      return { rows: [], rowCount: 1 };
    }
    if (sql.trim().startsWith('UPDATE')) {
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
}

module.exports = {
  Pool,
  __queries: queries,
  __setNextRows: (rows) => {
    nextRows = rows;
  },
  __reset: () => {
    queries.length = 0;
    nextRows = [];
  },
};
