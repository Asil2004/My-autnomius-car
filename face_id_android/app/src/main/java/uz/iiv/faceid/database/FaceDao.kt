package uz.iiv.faceid.database

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface FaceDao {
    @Query("SELECT * FROM registered_faces ORDER BY id DESC")
    fun getAll(): List<FaceEntity>

    @Query("SELECT * FROM registered_faces ORDER BY id DESC")
    fun getAllFlow(): Flow<List<FaceEntity>>

    @Query("SELECT * FROM registered_faces WHERE id = :id LIMIT 1")
    suspend fun getById(id: Long): FaceEntity?

    @Query("SELECT * FROM registered_faces WHERE fullName LIKE '%' || :query || '%'")
    suspend fun searchByName(query: String): List<FaceEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(face: FaceEntity): Long

    @Delete
    suspend fun delete(face: FaceEntity)

    @Query("DELETE FROM registered_faces WHERE id = :id")
    suspend fun deleteById(id: Long)

    @Query("SELECT COUNT(*) FROM registered_faces")
    suspend fun getCount(): Int

    @Query("DELETE FROM registered_faces")
    suspend fun clearAll()
}
