package uz.iiv.faceid.database

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters

@Database(entities = [FaceEntity::class], version = 1, exportSchema = false)
@TypeConverters(FloatArrayConverter::class)
abstract class AppDatabase : RoomDatabase() {

    abstract fun faceDao(): FaceDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "qalqon_faceid.db"
                ).build()
                INSTANCE = instance
                instance
            }
        }
    }
}
