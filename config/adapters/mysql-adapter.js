// adapters/mysql-adapter.js

class MySQLAdapter {
  constructor(dbConfig, mysqlDriver) {
    this.dbConfig = dbConfig;
    this.mysql = mysqlDriver;
    this.pool = null;
  }

  async initialize() {
    this.pool = this.mysql.createPool({
      host: this.dbConfig.host,
      port: this.dbConfig.port,
      user: this.dbConfig.user,
      password: this.dbConfig.password,
      waitForConnections: true,
      connectionLimit: 20,
      queueLimit: 0,
      idleTimeout: 900000,
      connectTimeout: 60000,
      multipleStatements: false,
      timezone: '+00:00',
      charset: 'utf8mb4'
    });

    // Test connection
    const connection = await this.pool.getConnection();
    await connection.query('SELECT 1');
    connection.release();
    console.log('✅ MySQL pool initialized');
  }

  async query(database, sql, params = []) {
    let connection;
    try {
      connection = await this.pool.getConnection();
      await connection.query(`USE \`${database}\``);
      const [rows, fields] = await connection.query(sql, params);
      return [rows, fields];
    } finally {
      if (connection) connection.release();
    }
  }

  async execute(database, sql, params = []) {
    let connection;
    try {
      connection = await this.pool.getConnection();
      await connection.query(`USE \`${database}\``);
      const [rows, fields] = await connection.query(sql, params);
      return [rows, fields];
    } finally {
      if (connection) connection.release();
    }
  }

  async getConnection(database) {
    const connection = await this.pool.getConnection();
    if (database) {
      await connection.query(`USE \`${database}\``);
    }
    return connection;
  }

  async queryWithConnection(connection, sql, params = []) {
    const [rows, fields] = await connection.query(sql, params);
    return [rows, fields];
  }

  async executeWithConnection(connection, sql, params = []) {
    const [rows, fields] = await connection.query(sql, params);
    return [rows, fields];
  }

  async beginTransaction(connection) {
    await connection.beginTransaction();
  }

  async commitTransaction(connection) {
    await connection.commit();
  }

  async rollbackTransaction(connection) {
    await connection.rollback();
  }

  releaseConnection(connection) {
    connection.release();
  }

  async rawQuery(sql, params = []) {
    let connection;
    try {
      connection = await this.pool.getConnection();
      const [rows, fields] = await connection.query(sql, params);
      return [rows, fields];
    } finally {
      if (connection) connection.release();
    }
  }

  async testDatabase(dbName) {
    let connection;
    try {
      connection = await this.pool.getConnection();
      await connection.query(`USE \`${dbName}\``);
      await connection.query('SELECT 1');
    } finally {
      if (connection) connection.release();
    }
  }

  async healthCheck() {
    const connection = await this.pool.getConnection();
    await connection.query('SELECT 1 as health_check');
    connection.release();
  }

  getStats() {
    if (!this.pool || !this.pool.pool) return {};
    return {
      totalConnections: this.pool.pool._allConnections.length,
      freeConnections: this.pool.pool._freeConnections.length,
      usedConnections: this.pool.pool._allConnections.length - this.pool.pool._freeConnections.length,
      queuedRequests: this.pool.pool._connectionQueue.length
    };
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      console.log('✅ MySQL pool closed');
    }
  }
}

module.exports = MySQLAdapter;


