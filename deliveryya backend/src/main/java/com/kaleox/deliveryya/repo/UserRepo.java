package com.kaleox.deliveryya.repo;

import com.kaleox.deliveryya.entities.User;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

@Repository
public interface UserRepo extends JpaRepository<User, Integer>, JpaSpecificationExecutor<User> {

    Optional<User> findUserByEmail(@NotNull @Size(max = 100) @Email String email);

    Optional<User> findUserByNic(String nic);

    /** Every user whose role is one of the given roles (used to resolve "who holds this access"). */
    List<User> findAllByUserRole_IdIn(Collection<Integer> userRoleIds);
}
