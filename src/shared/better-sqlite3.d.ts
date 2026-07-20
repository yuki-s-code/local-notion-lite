declare module 'better-sqlite3' {
  export interface Statement {
    run(...params: any[]): any;
    get(...params: any[]): any;
    all(...params: any[]): any[];
  }
  export interface TransactionFunction<TArgs extends any[] = any[], TResult = any> {
    (...params: TArgs): TResult;
    default(...params: TArgs): TResult;
    deferred(...params: TArgs): TResult;
    immediate(...params: TArgs): TResult;
    exclusive(...params: TArgs): TResult;
  }

  export interface Database {
    pragma(source: string, options?: any): any;
    exec(source: string): void;
    prepare(source: string): Statement;
    transaction<TArgs extends any[] = any[], TResult = any>(fn: (...params: TArgs) => TResult): TransactionFunction<TArgs, TResult>;
    loadExtension(path: string): void;
    close(): void;
  }
  export interface DatabaseConstructor {
    new (filename: string, options?: any): Database;
    (filename: string, options?: any): Database;
  }
  const Database: DatabaseConstructor;
  export default Database;
}
